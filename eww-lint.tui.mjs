#!/usr/bin/env node
/**
 * eww·lint v1.0 — TUI-анализатор и оптимизатор конфигов ElKowars Wacky Widgets
 *
 * Чистый Node.js ≥ 18, ноль зависимостей. Читает папку конфига напрямую:
 *
 *   node eww-lint.tui.mjs ~/.config/eww        # интерактивный TUI (в TTY)
 *   node eww-lint.tui.mjs --report             # отчёт как у линтера (для CI)
 *   node eww-lint.tui.mjs --json               # машиночитаемый вывод
 *
 * В TUI: правьте файлы в редакторе — инструмент пересканирует конфиг сам.
 * Выходные коды: 0 — чисто, 1 — найдены ошибки, 2 — не удалось прочитать конфиг.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const VERSION = "1.0.0";

/* ────────────────────────────────────────────────────────────
 * Терминал: цвет и примитивы ANSI
 * ──────────────────────────────────────────────────────────── */

const NO_COLOR = !!process.env.NO_COLOR;
let COLOR = process.stdout.isTTY && !NO_COLOR;
const forceNoColor = () => (COLOR = false);

const A = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", inv: "\x1b[7m",
  /* яркие варианты (9x) — читаемы на тёмных темах терминала */
  red: "\x1b[91m", green: "\x1b[92m", yellow: "\x1b[93m",
  cyan: "\x1b[96m",
  /* вспомогательный текст: 245 (#8a8a8a) — видно даже на чисто чёрном фоне;
     90 (bright black) на многих темах почти неразличим */
  gray: "\x1b[38;5;245m",
  mut: "\x1b[38;5;250m",
};
const paint = (code, s) => (COLOR ? code + s + A.reset : s);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const visLen = (s) => strip(s).length;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (s, w) => {
  const d = w - visLen(s);
  return d > 0 ? s + " ".repeat(d) : s;
};
const truncate = (s, w) => {
  if (visLen(s) <= w) return s;
  // режем по видимой длине, сохраняя esc-последовательности простыми:
  const plain = strip(s);
  return plain.slice(0, Math.max(1, w - 1)) + "…";
};

/* ────────────────────────────────────────────────────────────
 * Парсер yuck: s-выражения, блоки, команды
 * ──────────────────────────────────────────────────────────── */

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

const parseInterval = (raw) => {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2] ?? "s";
  if (unit === "ms") return v / 1000;
  if (unit === "m") return v * 60;
  return v;
};

const closeSexpr = (src, openIdx) => {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ";") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
};

const findBlocks = (src) => {
  const out = [];
  const re = /\(\s*(defpoll|deflisten|defvar|defwidget|defwindow)\s+([A-Za-z0-9_.$-]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const end = closeSexpr(src, m.index);
    const body = end > 0 ? src.slice(m.index + 1, end) : src.slice(m.index + 1, m.index + 400);
    out.push({ kind: m[1], name: m[2], line: lineOf(src, m.index), body });
  }
  return out;
};

const lastCommand = (body) => {
  const backticks = [...body.matchAll(/`([^`]*)`/g)];
  if (backticks.length) return backticks[backticks.length - 1][1];
  const quotes = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  if (quotes.length) return quotes[quotes.length - 1][1];
  return "";
};

/* ────────────────────────────────────────────────────────────
 * Правила: yuck
 * ──────────────────────────────────────────────────────────── */

const LISTENABLE = [
  {
    re: /pamixer|amixer\s+get|pactl\s+get|wpctl\s+get-volume/,
    title: "Громкость меняется по событию — слушайте, а не опрашивайте",
    detail: "PulseAudio/PipeWire сами сообщают об изменении громкости. deflisten с pactl subscribe реагирует мгновенно и не будит shell каждые N секунд.",
    fix: '(deflisten volume :initial "0"\n  `pactl subscribe | while read -r _; do pamixer --get-volume; done`)',
  },
  {
    re: /playerctl\s+metadata|playerctl\s+status/,
    title: "playerctl умеет стримить изменения — опрос не нужен",
    detail: "Флаг -F (follow) выводит новую строку при каждой смене трека/статуса: пауза видна сразу, а не через интервал.",
    fix: '(deflisten player :initial ""\n  `playerctl -a metadata --format "{{artist}} — {{title}}" -F`)',
  },
  {
    re: /power_supply\/BAT|upower\s+-i/,
    title: "Батарея шлёт uevent'ы — перейдите на udevadm",
    detail: "cat /sys/... раз в 2 секунды — 30 лишних fork'ов в минуту. udevadm monitor отдаёт строку ровно тогда, когда заряд изменился.",
    fix: "(deflisten battery :initial \"100\"\n  `udevadm monitor --subsystem-match=power_supply | while read -r _; do cat /sys/class/power_supply/BAT0/capacity; done`)",
  },
  {
    re: /iwgetid|nmcli\s+(d|dev)\s+wifi|ip\s+(addr|link)/,
    title: "Состояние сети — событийное, не поллится",
    detail: "NetworkManager публикует события в dbus; udevadm по подсистеме net сообщит о смене SSID сам.",
    fix: "(deflisten net :initial \"\"\n  `udevadm monitor --subsystem-match=net | while read -r _; do iwgetid -r; done`)",
  },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const analyzeYuck = (src, diags, filePath, allYuckSrc) => {
  const stats = { windows: 0, widgets: 0, polls: 0, listens: 0, vars: 0, updatesPerMin: 0 };
  if (!src.trim()) return stats;
  const push = (d) => diags.push({ file: filePath, ...d });

  /* баланс скобок */
  let open = 0, closed = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "`") {
      const q = ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (ch === ";") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "(") open++;
    if (ch === ")") closed++;
  }
  if (open !== closed) {
    push({
      line: src.split("\n").length, severity: "error", tag: "синтаксис",
      title: "Скобки не сбалансированы",
      detail: `Открывающих «(» — ${open}, закрывающих «)» — ${closed}. eww откажется парсить файл целиком.`,
    });
  }

  const blocks = findBlocks(src);

  /* defpoll */
  const pollCommands = new Map();
  for (const b of blocks) {
    if (b.kind !== "defpoll") continue;
    stats.polls++;
    const cmd = lastCommand(b.body);
    const intMatch = b.body.match(/:interval\s*"([^"]+)"/);
    if (!intMatch) {
      push({
        line: b.line, severity: "error", tag: "синтаксис",
        title: `defpoll «${b.name}» без :interval`,
        detail: "У defpoll интервал обязателен — без него eww бросит ошибку при загрузке конфига.",
        fix: `(defpoll ${b.name} :interval "5s" \`...\`)`,
      });
      continue;
    }
    const sec = parseInterval(intMatch[1]);
    if (sec === null) {
      push({
        line: b.line, severity: "error", tag: "синтаксис",
        title: `Не удалось разобрать интервал «${intMatch[1]}»`,
        detail: 'Поддерживаются форматы "500ms", "1s", "5m". Проверьте значение :interval.',
      });
      continue;
    }
    stats.updatesPerMin += 60 / sec;

    if (sec < 0.3) {
      push({
        line: b.line, severity: "error", tag: "производительность",
        title: `Опрос каждые ${intMatch[1]} — ${Math.round(60 / sec)} запусков shell в минуту`,
        detail: "Каждый тик — fork shell + запуск команды + парсинг + перерисовка. Быстрее 1s оправданы только анимации.",
        fix: `(defpoll ${b.name} :interval "1s" \`...\`)`,
      });
    } else if (sec < 1) {
      push({
        line: b.line, severity: "warning", tag: "производительность",
        title: `Интервал ${intMatch[1]} избыточен`,
        detail: "Для текста 1s визуально неотличима от 0.5s, но вдвое дешевле по CPU.",
        fix: `(defpoll ${b.name} :interval "1s" \`...\`)`,
      });
    }

    if (/\bdate\b/.test(cmd) && sec < 1) {
      push({
        line: b.line, severity: "warning", tag: "производительность",
        title: "Часы достаточно обновлять раз в секунду",
        detail: "Секунды — максимум, что видно; при :interval \"1s\" команда date стартует в такт смене секунд.",
        fix: `(defpoll ${b.name} :interval "1s" \`date '+%H:%M:%S'\`)`,
      });
    }

    for (const rule of LISTENABLE) {
      if (rule.re.test(cmd)) {
        push({ line: b.line, severity: "warning", tag: "производительность", title: rule.title, detail: rule.detail, fix: rule.fix });
        break;
      }
    }

    if (/curl|wget|nc\s/.test(cmd)) {
      push({
        line: b.line, severity: sec < 300 ? "warning" : "hint", tag: "сеть",
        title: `Сетевой запрос в опросе каждые ${intMatch[1]}`,
        detail: "Каждый тик поднимает TLS-соединение: трафик, батарея, rate-limit. Кэшируйте в файл или поднимите интервал до минут.",
        fix: `(defpoll ${b.name} :interval "10m" \`...\`)`,
      });
    }

    if (/convert |ffmpeg|magick /.test(cmd) && sec < 5) {
      push({
        line: b.line, severity: "warning", tag: "производительность",
        title: "Тяжёлая обработка изображения на каждом тике",
        detail: "convert/ffmpeg запускаются чаще, чем меняется исходник. Регенерируйте по событию через deflisten.",
        fix: "(deflisten cover `playerctl -a metadata mpris:artUrl -F | while read -r u; do ... convert ...; echo /tmp/cover.png; done`)",
      });
    }

    if (/eww\s+update/.test(cmd)) {
      push({
        line: b.line, severity: "hint", tag: "структура",
        title: "«eww update» внутри скрипта — лишний процесс",
        detail: "defpoll уже передаёт stdout переменной. Просто выводите значение в stdout.",
        fix: "# вместо `...; eww update x \"$v\"` — просто `echo \"$v\"` в stdout",
      });
    }

    if (cmd.length > 160) {
      push({
        line: b.line, severity: "hint", tag: "структура",
        title: "Длинный инлайн-скрипт в defpoll",
        detail: "Скрипты длиннее пары команд лучше выносить в ~/.config/eww/scripts/.",
        fix: `(defpoll ${b.name} :interval "${intMatch[1]}" \`~/.config/eww/scripts/${b.name}.sh\`)`,
      });
    }

    const key = cmd.replace(/\s+/g, " ").trim();
    if (pollCommands.has(key)) {
      push({
        line: b.line, severity: "warning", tag: "структура",
        title: "Два defpoll запускают одну и ту же команду",
        detail: `Та же команда уже выполняется в defpoll на строке ${pollCommands.get(key)}. Оставьте один опрос.`,
      });
    } else {
      pollCommands.set(key, b.line);
    }
  }

  /* deflisten: busy-loop */
  for (const b of blocks) {
    if (b.kind !== "deflisten") continue;
    stats.listens++;
    const cmd = lastCommand(b.body);
    if (/\b(while|until)\b|; do\b/.test(cmd) && !/sleep|read\s+-r|inotifywait|subscribe|monitor|udevadm|-F\b|--follow|wait\s/.test(cmd)) {
      push({
        line: b.line, severity: "error", tag: "производительность",
        title: "Busy-loop в deflisten: цикл без паузы и без блокирующего чтения",
        detail: "while true без sleep/read крутит 100% одного ядра — тысячи перезапусков в секунду. Добавьте sleep, read или подписку.",
        fix: "# минимально: вставьте sleep в цикл\nwhile true; do cat /sys/class/power_supply/BAT0/capacity; sleep 2; done",
      });
    }
  }

  /* окна */
  for (const b of blocks) {
    if (b.kind !== "defwindow") continue;
    stats.windows++;
    if (!/:geometry/.test(b.body)) {
      push({
        line: b.line, severity: "warning", tag: "разметка",
        title: `У окна «${b.name}» нет :geometry`,
        detail: "Без явной геометрии окно может растянуться на весь экран — зависит от WM.",
        fix: ':geometry (geometry :x "0%" :y "0%" :width "100%" :height "34px" :anchor "top center")',
      });
    }
    if (/bar|panel|dock|status/i.test(b.name) && !/:exclusive\s+true/.test(b.body)) {
      push({
        line: b.line, severity: "hint", tag: "разметка",
        title: "Бар стоит сделать :exclusive true",
        detail: "exclusive-окно просит WM зарезервировать место: тайловые окна перестанут заезжать под бар.",
        fix: ":exclusive true",
      });
    }
  }

  /* неиспользуемые определения (по всем файлам проекта) */
  for (const b of blocks) {
    if (b.kind !== "defvar" && b.kind !== "defwidget") continue;
    if (b.kind === "defvar") stats.vars++;
    else stats.widgets++;
    const bare = b.name.replace(/^\$/, "");
    const reName = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(bare)}(?![A-Za-z0-9_-])`, "g");
    const total = (allYuckSrc.match(reName) ?? []).length;
    if (total <= 1) {
      push({
        line: b.line, severity: "hint", tag: "структура",
        title: `«${bare}» нигде не используется`,
        detail: b.kind === "defvar"
          ? "Переменная определена, но ни один виджет её не читает — мёртвый код."
          : "Виджет определён, но ни одно окно его не рендерит.",
      });
    }
  }

  stats.updatesPerMin = Math.round(stats.updatesPerMin);
  return stats;
};

/* ────────────────────────────────────────────────────────────
 * Правила: scss
 * ──────────────────────────────────────────────────────────── */

const analyzeScss = (src, diags, filePath) => {
  if (!src.trim()) return;
  const push = (d) => diags.push({ file: filePath, ...d });
  const lines = src.split("\n");

  let depth = 0, flagged = false;
  lines.forEach((ln, i) => {
    if (/^\s*(\/\/|\/\*)/.test(ln)) return;
    for (const ch of ln) {
      if (ch === "{") depth++;
      if (ch === "}") depth = Math.max(0, depth - 1);
    }
    if (depth > 4 && !flagged) {
      flagged = true;
      push({
        line: i + 1, severity: "hint", tag: "стиль",
        title: "Вложенность селекторов глубже 4 уровней",
        detail: "Длинные селекторы дороже матчить при каждой перерисовке. Вынесите внутренние блоки наверх (BEM: .bar__icon).",
      });
    }
  });

  const hexes = new Map();
  for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const h = m[0].toLowerCase();
    hexes.set(h, (hexes.get(h) ?? 0) + 1);
  }
  for (const [hex, n] of hexes) {
    if (n >= 3) {
      push({
        line: lineOf(src, src.indexOf(hex)), severity: "hint", tag: "стиль",
        title: `Цвет ${hex} повторяется ${n} раз`,
        detail: "Одна $переменная на цвет — смена темы в одну строку.",
        fix: `$accent: ${hex};\n... color: $accent;`,
      });
    }
  }

  if (/:hover/.test(src) && !/transition/.test(src)) {
    push({
      line: lineOf(src, src.search(/:hover/)), severity: "hint", tag: "ux",
      title: "Hover-эффект без transition",
      detail: "Без transition цвет переключается рывком. 150ms ease почти бесплатны.",
      fix: "transition: color 150ms ease, background-color 150ms ease;",
    });
  }

  lines.forEach((ln, i) => {
    if (/box-shadow/.test(ln)) {
      const nums = [...ln.matchAll(/(\d{2,3})px/g)].map((m) => parseInt(m[1]));
      if (nums.some((n) => n >= 30)) {
        push({
          line: i + 1, severity: "warning", tag: "производительность",
          title: "box-shadow с blur ≥ 30px",
          detail: "Большие тени композитор пересчитывает при каждой перерисовке. Достаточно 8–16px.",
          fix: ln.replace(/(\d{2,3})px/g, (s) => `${Math.min(parseInt(s), 16)}px`).trim(),
        });
      }
    }
    const blur = ln.match(/(?:backdrop-)?filter\s*:[^;]*blur\(\s*(\d+)/);
    if (blur && parseInt(blur[1]) > 0) {
      push({
        line: i + 1, severity: "warning", tag: "производительность",
        title: `blur(${blur[1]}px) — дорогой фильтр`,
        detail: "Размытие фона пересчитывается каждый кадр. Снизьте до 8–12px или замените полупрозрачной подложкой.",
        fix: "backdrop-filter: blur(10px);",
      });
    }
  });

  const starIdx = src.search(/^\s*\*[\s,{]/m);
  if (starIdx >= 0) {
    push({
      line: lineOf(src, starIdx), severity: "hint", tag: "стиль",
      title: "Селектор * применяется ко всем элементам",
      detail: "«* { all: unset }» матчится на каждый узел при каждой перерисовке.",
    });
  }

  const imps = [...src.matchAll(/!important/g)];
  if (imps.length >= 3) {
    push({
      line: lineOf(src, imps[0].index ?? 0), severity: "hint", tag: "стиль",
      title: `!important используется ${imps.length} раза`,
      detail: "Признак борьбы со специфичностью — упростите селекторы.",
    });
  }

  if (lines.length > 80 && !/\$[\w-]+\s*:/.test(src)) {
    push({
      line: 1, severity: "hint", tag: "стиль",
      title: "Большой файл без SCSS-переменных",
      detail: "Вынесите палитру в переменные — правка темы станет однострочной.",
    });
  }
};

/* ────────────────────────────────────────────────────────────
 * Уровень проекта: include-граф, дубли между файлами
 * ──────────────────────────────────────────────────────────── */

const normalizePath = (p) => p.replace(/^\.\//, "").replace(/\/{2,}/g, "/").trim();
const baseName = (p) => p.split("/").pop() ?? p;

const analyzeProject = (files, scssFile) => {
  const diagnostics = [];
  const push = (d) => diagnostics.push(d);

  const allYuckSrc = files.map((f) => f.content).join("\n");

  /* include */
  const includes = [];
  const resolve = (target, selfPath) => {
    const tn = normalizePath(target);
    const cands = files.filter((x) => x.path !== selfPath);
    return (
      cands.find((x) => x.path === tn)?.path ??
      cands.find((x) => x.path.endsWith("/" + tn))?.path ??
      cands.find((x) => baseName(x.path) === baseName(tn))?.path ??
      null
    );
  };
  for (const f of files) {
    const re = /\(\s*include\s+"([^"]+)"\s*\)/g;
    let m;
    while ((m = re.exec(f.content))) {
      includes.push({ fromPath: f.path, target: m[1], line: lineOf(f.content, m.index), resolved: resolve(m[1], f.path) });
    }
  }
  for (const inc of includes) {
    if (!inc.resolved) {
      push({
        file: inc.fromPath, line: inc.line, severity: "warning", tag: "include",
        title: `include «${inc.target}» не найден среди файлов проекта`,
        detail: "eww ищет путь относительно ~/.config/eww. Файл отсутствует в папке или лежит вне её.",
        fix: `(include "${inc.target}")  ; путь указывается от корня ~/.config/eww`,
      });
    }
  }

  const graph = new Map();
  for (const inc of includes) {
    if (!inc.resolved) continue;
    if (!graph.has(inc.fromPath)) graph.set(inc.fromPath, []);
    graph.get(inc.fromPath).push(inc);
  }
  const walk = (node, stack) => {
    for (const inc of graph.get(node) ?? []) {
      const next = inc.resolved;
      const at = stack.indexOf(next);
      if (at >= 0) {
        push({
          file: inc.fromPath, line: inc.line, severity: "error", tag: "include",
          title: "Цикл include: файл включает сам себя через цепочку",
          detail: `Цепочка: ${[...stack.slice(at), next].join(" → ")}. eww зациклится при загрузке.`,
          fix: `; удалите (include "${inc.target}") в одном из файлов цепочки`,
        });
        continue;
      }
      if (stack.length >= 5) {
        push({
          file: inc.fromPath, line: inc.line, severity: "hint", tag: "include",
          title: "Цепочка include глубже 5 уровней",
          detail: "Уплощите структуру: 2–3 уровня обычно достаточно.",
        });
        continue;
      }
      walk(next, [...stack, next]);
    }
  };
  const rootPath = files[0]?.path ?? "eww.yuck";
  walk(rootPath, [rootPath]);

  const referenced = new Set(includes.map((i) => i.resolved).filter(Boolean));
  for (const f of files) {
    if (f.path === rootPath) continue;
    if (!referenced.has(f.path)) {
      push({
        file: f.path, line: 1, severity: "hint", tag: "include",
        title: "Файл есть в папке, но ни один include на него не ссылается",
        detail: `Добавьте (include "${f.path}") в ${rootPath}, иначе eww не увидит его определения.`,
        fix: `(include "${f.path}")`,
      });
    }
  }

  /* дубли определений между файлами */
  const seen = new Map();
  for (const f of files) {
    for (const b of findBlocks(f.content)) {
      const key = `${b.kind}:${b.name}`;
      const first = seen.get(key);
      if (first) {
        push({
          file: f.path, line: b.line, severity: "error", tag: "структура",
          title: `Повторное определение «${b.name}»`,
          detail: `Первое определение — ${first.path}, стр. ${first.line}. eww возьмёт последнее загруженное.`,
        });
      } else {
        seen.set(key, { path: f.path, line: b.line });
      }
    }
  }

  /* правила каждого файла */
  const stats = { windows: 0, widgets: 0, polls: 0, listens: 0, vars: 0, updatesPerMin: 0, files: files.length, includesTotal: includes.length, includesResolved: includes.filter((i) => i.resolved).length };
  for (const f of files) {
    const st = analyzeYuck(f.content, diagnostics, f.path, allYuckSrc);
    stats.windows += st.windows; stats.widgets += st.widgets; stats.polls += st.polls;
    stats.listens += st.listens; stats.vars += st.vars; stats.updatesPerMin += st.updatesPerMin;
  }
  if (scssFile) analyzeScss(scssFile.content, diagnostics, scssFile.path);

  const RANK = { error: 0, warning: 1, hint: 2 };
  const WEIGHT = { error: 10, warning: 5, hint: 2 };
  const order = new Map(files.map((f, i) => [f.path, i]));
  if (scssFile) order.set(scssFile.path, files.length);
  diagnostics.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || (order.get(a.file) ?? 99) - (order.get(b.file) ?? 99) || a.line - b.line
  );

  const penalty = diagnostics.reduce((s, d) => s + WEIGHT[d.severity], 0);
  const score = diagnostics.length === 0 ? 100 : Math.max(4, 100 - penalty);
  const grade = score >= 85 ? "отлично" : score >= 65 ? "хорошо" : score >= 40 ? "средне" : "требует работы";

  return { diagnostics, score, grade, stats, rootPath, files };
};

/* ────────────────────────────────────────────────────────────
 * Файловая система: сканирование папки конфига
 * ──────────────────────────────────────────────────────────── */

const scanProject = (rootDir) => {
  const found = [];
  const dirs = [];
  const walk = (dir) => {
    dirs.push(dir);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(yuck|scss)$/i.test(ent.name)) {
        found.push({
          abs: p,
          rel: path.relative(rootDir, p).split(path.sep).join("/"),
          content: fs.readFileSync(p, "utf8"),
        });
      }
    }
  };
  walk(rootDir);

  const yucks = found.filter((f) => /\.yuck$/i.test(f.rel));
  const scssAll = found.filter((f) => /\.scss$/i.test(f.rel));
  const withDepth = yucks.map((f) => ({ ...f, depth: f.rel.split("/").length }));
  const rootYuck =
    withDepth.filter((f) => baseName(f.rel) === "eww.yuck").sort((a, b) => a.depth - b.depth)[0] ??
    [...withDepth].sort((a, b) => a.depth - b.depth)[0];

  if (!rootYuck) return { files: [], scssFile: null, skipped: found.length, dirs };

  const baseDir = rootYuck.rel.includes("/") ? rootYuck.rel.slice(0, rootYuck.rel.lastIndexOf("/")) : "";
  const inSubtree = (rel) => (baseDir ? rel.startsWith(baseDir + "/") : true);
  const relTo = (rel) => (baseDir ? rel.slice(baseDir.length + 1) : rel);

  const files = [{ path: baseName(rootYuck.rel), abs: rootYuck.abs, content: rootYuck.content }];
  for (const f of yucks) {
    if (f.rel === rootYuck.rel || !inSubtree(f.rel)) continue;
    files.push({ path: relTo(f.rel), abs: f.abs, content: f.content });
  }

  const scssCands = scssAll.filter((f) => inSubtree(f.rel));
  const scssRoot = scssCands.find((f) => baseName(f.rel) === "eww.scss") ?? scssCands[0] ?? null;
  const scssFile = scssRoot ? { path: "eww.scss", abs: scssRoot.abs, content: scssRoot.content } : null;

  return { files, scssFile, dirs, yuckCount: yucks.length, scssCount: scssAll.length };
};

/* ────────────────────────────────────────────────────────────
 * Режим отчёта (non-TTY / --report / CI)
 * ──────────────────────────────────────────────────────────── */

const SEV_SYM = { error: "✖", warning: "▲", hint: "·" };
const SEV_RU = { error: "ошибка", warning: "предупр.", hint: "совет" };
const sevColor = (sev, s) =>
  sev === "error" ? paint(A.red, s) : sev === "warning" ? paint(A.yellow, s) : paint(A.cyan, s);

const printReport = (rootDir, res) => {
  const w = process.stdout.columns || 100;
  console.log(paint(A.bold, `eww·lint v${VERSION}`) + paint(A.gray, ` — ${rootDir}`));
  console.log(
    paint(A.gray,
      `файлов: ${res.stats.files} yuck${res.scssFile ? " + 1 scss" : ""} · include: ${res.stats.includesResolved}/${res.stats.includesTotal} · ${res.stats.updatesPerMin} обн/мин`)
  );
  console.log();

  const byFile = new Map();
  for (const d of res.diagnostics) {
    if (!byFile.has(d.file)) byFile.set(d.file, []);
    byFile.get(d.file).push(d);
  }

  for (const [file, list] of byFile) {
    console.log(paint(A.bold, file));
    for (const d of list) {
      const loc = paint(A.gray, `${String(d.line).padStart(4)}  `);
      const sev = pad(sevColor(d.severity, `${SEV_SYM[d.severity]} ${SEV_RU[d.severity]}`), 24);
      const tag = paint(A.gray, `[${d.tag}] `);
      console.log(`  ${loc}${sev}${tag}${d.title}`);
      if (process.stdout.isTTY) console.log(paint(A.gray, `        ${truncate(d.detail, w - 10)}`));
    }
    console.log();
  }

  const errs = res.diagnostics.filter((d) => d.severity === "error").length;
  const warns = res.diagnostics.filter((d) => d.severity === "warning").length;
  const hints = res.diagnostics.filter((d) => d.severity === "hint").length;
  if (res.diagnostics.length === 0) {
    console.log(paint(A.green, "✔ Конфиг в отличной форме: находок нет."));
  } else {
    console.log(
      paint(A.bold, `${res.diagnostics.length} находок: `) +
        paint(A.red, `${errs} ошибок`) + ", " + paint(A.yellow, `${warns} предупреждений`) + ", " +
        paint(A.cyan, `${hints} советов`)
    );
  }
  const scoreColor = res.score >= 85 ? A.green : res.score >= 65 ? A.yellow : A.red;
  console.log(paint(A.bold, `индекс оптимизации: `) + paint(scoreColor, `${res.score}/100 (${res.grade})`));
  console.log(paint(A.gray, `совет: откройте TUI — node eww-lint.tui.mjs "${rootDir}" — и чините находки с live-пересканированием`));
};

/* ────────────────────────────────────────────────────────────
 * TUI: полноэкранный интерфейс
 * ──────────────────────────────────────────────────────────── */

const HELP = `eww·lint v${VERSION} — анализатор конфигов ElKowars Wacky Widgets

Использование:
  node eww-lint.tui.mjs [путь] [флаги]

  путь          папка конфига (по умолчанию ~/.config/eww)

Флаги:
  --report      неинтерактивный отчёт (по умолчанию вне TTY)
  --json        вывод в JSON (для CI и скриптов)
  --no-color    отключить цвет
  -h, --help    эта справка

Интерактивный режим:
  j/k, ↑/↓      навигация            tab, h/l    смена панели
  enter         открыть в $EDITOR    f           фильтр: все→ошибки→предупр.→советы
  0/1/2/3       фильтр: все/ошибки/предупреждения/советы
  r             пересканировать      q, esc, ^C  выход

Правьте файлы в редакторе — TUI пересканирует конфиг автоматически.
Выходные коды: 0 — чисто, 1 — есть ошибки, 2 — не удалось прочитать.`;

const tui = {
  rootDir: "",
  res: null,
  scanError: null,
  pane: 1, // 0 — файлы, 1 — находки
  fileIdx: 0, // 0 = «все файлы»
  diagIdx: 0,
  filter: "all",
  scroll: 0,
  detailScroll: 0,
};

const FILTERS = ["all", "error", "warning", "hint"];
const FILTER_RU = { all: "все", error: "ошибки", warning: "предупр.", hint: "советы" };

const visibleDiags = () => {
  const sel = tui.fileIdx === 0 ? null : tui.res.files[tui.fileIdx - 1]?.path;
  return tui.res.diagnostics.filter(
    (d) => (tui.filter === "all" || d.severity === tui.filter) && (sel === null || d.file === sel)
  );
};

const fileIssueCount = (p) => tui.res.diagnostics.filter((d) => d.file === p).length;

const bar = (w) => "─".repeat(Math.max(0, w));
const boxTop = (w, title) => `┌${title ? "─ " + title + " " : ""}${bar(Math.max(0, w - (title ? title.length + 3 : 1)))}┐`;
const boxBot = (w) => `└${bar(w)}┘`;
const row = (inner, w) => `│ ${pad(truncate(inner, w - 2), w - 2)} │`;

const render = () => {
  const cols = process.stdout.columns || 100;
  const rows = process.stdout.rows || 30;
  const out = [];

  /* шапка */
  const errs = tui.res.diagnostics.filter((d) => d.severity === "error").length;
  const scoreColor = tui.res.score >= 85 ? A.green : tui.res.score >= 65 ? A.yellow : A.red;
  const headerRight = `${paint(A.gray, "score ")}${paint(scoreColor, paint(A.bold, String(tui.res.score)))}${paint(A.gray, " · ")}${paint(A.gray, String(tui.res.stats.updatesPerMin) + " обн/мин")}${paint(A.gray, " · ")}${errs ? paint(A.red, errs + " ошиб.") : paint(A.green, "без ошибок")}`;
  const headerLeft = paint(A.bold, ` ▚ eww·lint v${VERSION} `) + paint(A.gray, truncate(tui.rootDir, cols - 60));
  out.push(pad(headerLeft, cols - visLen(headerRight)) + headerRight);
  out.push(paint(A.gray, bar(cols)));

  /* тела панелей */
  const bodyH = rows - 2 - 9 - 2; // шапка(2) + детали(9) + футер(2)
  const filesW = clamp(Math.floor(cols * 0.3), 24, 38);
  const diagW = cols - filesW - 1;
  const listH = Math.max(4, bodyH - 2);

  /* левая: файлы */
  const fLines = [];
  fLines.push(paint(A.gray, tui.pane === 0 ? paint(A.bold, "ФАЙЛЫ") : "ФАЙЛЫ") + paint(A.gray, `  ${tui.res.stats.files}${tui.res.scssFile ? "+scss" : ""}`));
  const fileEntries = [{ label: "все файлы", count: tui.res.diagnostics.length },
    ...tui.res.files.map((f) => ({ label: f.path, count: fileIssueCount(f.path) })),
    ...(tui.res.scssFile ? [{ label: "eww.scss", count: fileIssueCount("eww.scss") }] : [])];
  for (let i = 0; i < fileEntries.length; i++) {
    const e = fileEntries[i];
    const sel = tui.pane === 0 && i === tui.fileIdx;
    const active = tui.pane === 0;
    let cnt = e.count === 0 ? paint(A.green, "✓") : paint(e.count > 3 ? A.red : A.yellow, String(e.count).padStart(3));
    let label = truncate(e.label, filesW - 8);
    if (sel && active) label = paint(A.inv, pad(" " + label, filesW - 8));
    else if (sel) label = paint(A.gray, paint(A.bold, " " + label));
    else label = " " + label;
    fLines.push(label + "  " + cnt);
  }
  while (fLines.length < listH + 1) fLines.push("");

  /* правая: находки */
  const dLines = [];
  const selFile = tui.fileIdx === 0 ? null : fileEntries[tui.fileIdx]?.label;
  dLines.push(
    paint(A.gray, tui.pane === 1 ? paint(A.bold, "НАХОДКИ") : "НАХОДКИ") +
      paint(A.gray, ` — ${selFile ?? "все файлы"} · фильтр: `) + paint(A.bold, FILTER_RU[tui.filter]) +
      paint(A.gray, ` · ${visibleDiags().length}`)
  );
  const diags = visibleDiags();
  tui.diagIdx = clamp(tui.diagIdx, 0, Math.max(0, diags.length - 1));
  if (tui.diagIdx < tui.scroll) tui.scroll = tui.diagIdx;
  if (tui.diagIdx >= tui.scroll + listH) tui.scroll = tui.diagIdx - listH + 1;
  for (let i = tui.scroll; i < Math.min(diags.length, tui.scroll + listH); i++) {
    const d = diags[i];
    const sel = tui.pane === 1 && i === tui.diagIdx;
    const sym = sevColor(d.severity, SEV_SYM[d.severity]);
    const loc = paint(A.gray, `${d.file}:${d.line}`);
    const title = sel ? paint(A.inv, " " + truncate(d.title, diagW - 14)) : " " + truncate(d.title, diagW - 14);
    dLines.push(` ${sym} ${pad(loc, 26).slice(0, 40)}${title}`);
  }
  if (diags.length === 0) dLines.push(paint(A.green, "  ✔ пусто — находок нет"));
  while (dLines.length < listH + 1) dLines.push("");

  for (let i = 0; i < listH + 1; i++) {
    out.push(pad(fLines[i], filesW) + " " + pad(dLines[i], diagW));
  }

  /* детали выбранной находки */
  const d = diags[tui.diagIdx];
  out.push(paint(A.gray, bar(cols)));
  const detW = cols - 2;
  if (d) {
    out.push(paint(A.gray, "ДЕТАЛИ ") + sevColor(d.severity, `${SEV_SYM[d.severity]} ${SEV_RU[d.severity]}`) + paint(A.gray, ` · [${d.tag}] · ${d.file}:${d.line}`));
    out.push(paint(A.bold, truncate(d.title, detW)));
    const detLines = [d.detail];
    if (d.fix) detLines.push("", paint(A.green, "фикс:"));
    const fixLines = d.fix ? d.fix.split("\n").map((l) => "  " + paint(A.green, l)) : [];
    const all = [...detLines, ...fixLines];
    tui.detailScroll = clamp(tui.detailScroll, 0, Math.max(0, all.length - 6));
    for (let i = tui.detailScroll; i < Math.min(all.length, tui.detailScroll + 6); i++) {
      out.push(truncate(all[i], detW));
    }
    for (let i = all.length - tui.detailScroll; i < 6; i++) out.push("");
  } else {
    out.push(paint(A.gray, "ДЕТАЛИ — выберите находку"));
    for (let i = 0; i < 6; i++) out.push("");
  }

  /* футер */
  const keys = [
    ["↑↓/jk", "навигация"], ["tab", "панель"], ["⏎", "$EDITOR"], ["f", "фильтр"],
    ["r", "рескан"], ["q", "выход"],
  ];
  const footer = keys.map(([k, v]) => paint(A.bold, ` ${k} `) + paint(A.gray, v)).join(paint(A.gray, " ·"));
  out.push(paint(A.gray, bar(cols)));
  out.push(pad(footer, cols));

  process.stdout.write("\x1b[H" + out.slice(0, rows).map((l) => truncate(l, cols)).join("\r\n") + "\x1b[0m\r\n");
};

const rescan = () => {
  try {
    const scanned = scanProject(tui.rootDir);
    if (scanned.files.length === 0) {
      tui.scanError = "в папке не найдено .yuck-файлов";
      tui.res = { diagnostics: [], score: 0, grade: "—", stats: { files: 0, updatesPerMin: 0, includesTotal: 0, includesResolved: 0 }, files: [] };
    } else {
      tui.scanError = null;
      tui.res = analyzeProject(scanned.files, scanned.scssFile);
    }
  } catch (err) {
    tui.scanError = String(err.message || err);
  }
  tui.diagIdx = 0;
  tui.scroll = 0;
  tui.detailScroll = 0;
};

const openInEditor = (d) => {
  const files = tui.res.files ?? [];
  const target = d ? (d.file === "eww.scss" && tui.scssAbs ? { abs: tui.scssAbs } : files.find((f) => f.path === d.file)) : null;
  const abs = target?.abs ?? files[0]?.abs;
  if (!abs) return;
  const line = d?.line ?? 1;
  const editorRaw = process.env.EDITOR || process.env.VISUAL || "nvim";
  const editor = editorRaw.split(/\s+/)[0];
  const isCode = /(^|\/)(code|codium)$/.test(editor);
  const args = isCode
    ? [...editorRaw.split(/\s+/).slice(1), "--goto", `${abs}:${line}`]
    : [...editorRaw.split(/\s+/).slice(1), `+${line}`, abs];
  exitTui();
  const r = spawnSync(editor, args, { stdio: "inherit" });
  enterTui();
  if (r.error) {
    console.log(paint(A.yellow, `не удалось запустить ${editor}: ${r.error.message}. Задайте $EDITOR.`));
  }
  rescan();
  render();
};

const enterTui = () => {
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
};

const exitTui = () => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\x1b[?25h\x1b[?1049l");
};

const onKey = (buf) => {
  const k = buf.toString();
  const diags = visibleDiags();
  const fileCount = tui.res.stats.files + (tui.res.scssFile ? 1 : 0);

  if (k === "q" || k === "\x1b" || k === "\x03") {
    quit(errsCount() > 0 ? 1 : 0);
    return;
  }
  if (k === "r") { rescan(); render(); return; }
  if (k === "f") {
    tui.filter = FILTERS[(FILTERS.indexOf(tui.filter) + 1) % FILTERS.length];
    tui.diagIdx = 0; tui.scroll = 0; render(); return;
  }
  if (["0", "1", "2", "3"].includes(k)) {
    tui.filter = FILTERS[parseInt(k)];
    tui.diagIdx = 0; tui.scroll = 0; render(); return;
  }
  if (k === "\t" || (k === "l" && tui.pane === 0) || (k === "h" && tui.pane === 1)) {
    tui.pane = tui.pane === 0 ? 1 : 0; render(); return;
  }
  if (k === "j" || k === "\x1b[B") {
    if (tui.pane === 0) tui.fileIdx = clamp(tui.fileIdx + 1, 0, fileCount);
    else { tui.diagIdx = clamp(tui.diagIdx + 1, 0, Math.max(0, diags.length - 1)); tui.detailScroll = 0; }
    render(); return;
  }
  if (k === "k" || k === "\x1b[A") {
    if (tui.pane === 0) tui.fileIdx = clamp(tui.fileIdx - 1, 0, fileCount);
    else { tui.diagIdx = clamp(tui.diagIdx - 1, 0, Math.max(0, diags.length - 1)); tui.detailScroll = 0; }
    render(); return;
  }
  if (k === " ") {
    tui.detailScroll = clamp(tui.detailScroll + 3, 0, 12); render(); return;
  }
  if (k === "\r" || k === "\n") {
    if (tui.pane === 1) openInEditor(diags[tui.diagIdx] ?? null);
    else openInEditor(null);
    return;
  }
  if (k === "J") { tui.detailScroll = clamp(tui.detailScroll + 1, 0, 12); render(); }
  if (k === "K") { tui.detailScroll = clamp(tui.detailScroll - 1, 0, 12); render(); }
};

const errsCount = () => tui.res.diagnostics.filter((d) => d.severity === "error").length;

const quit = (code) => {
  exitTui();
  console.log(paint(A.gray, "eww·lint: ") + paint(A.bold, `индекс ${tui.res.score}/100 · ${tui.res.diagnostics.length} находок · ${tui.res.stats.updatesPerMin} обн/мин`));
  process.exit(code);
};

/* ────────────────────────────────────────────────────────────
 * Точка входа
 * ──────────────────────────────────────────────────────────── */

const main = () => {
  const args = process.argv.slice(2);
  let mode = "auto";
  let target = null;

  for (const a of args) {
    if (a === "-h" || a === "--help") { console.log(HELP); return; }
    else if (a === "--report") mode = "report";
    else if (a === "--json") mode = "json";
    else if (a === "--no-color") forceNoColor();
    else if (!a.startsWith("-")) target = a;
  }

  const rootDir = path.resolve(target ?? path.join(os.homedir(), ".config", "eww"));
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    console.error(paint(A.red, `ошибка: папка не найдена: ${rootDir}`));
    console.error(paint(A.gray, "укажите путь: node eww-lint.tui.mjs ~/.config/eww"));
    process.exit(2);
  }

  const scanned = scanProject(rootDir);
  if (scanned.files.length === 0) {
    console.error(paint(A.red, `ошибка: в ${rootDir} нет .yuck-файлов`));
    process.exit(2);
  }
  const res = analyzeProject(scanned.files, scanned.scssFile);

  if (mode === "json") {
    console.log(JSON.stringify({ path: rootDir, score: res.score, grade: res.grade, stats: res.stats, diagnostics: res.diagnostics }, null, 2));
    process.exit(res.diagnostics.some((d) => d.severity === "error") ? 1 : 0);
    return;
  }

  if (mode === "report" || !process.stdout.isTTY) {
    printReport(rootDir, res);
    process.exit(res.diagnostics.some((d) => d.severity === "error") ? 1 : 0);
    return;
  }

  /* интерактивный TUI */
  tui.rootDir = rootDir;
  tui.res = res;
  tui.scssAbs = scanned.scssFile?.abs ?? null;
  tui.pane = res.diagnostics.length ? 1 : 0;

  enterTui();
  render();
  process.stdin.on("data", onKey);
  process.stdout.on("resize", render);

  /* автообновление: следим за всеми папками проекта */
  let debounce = null;
  for (const dir of scanned.dirs ?? []) {
    try {
      fs.watch(dir, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { rescan(); render(); }, 250);
      });
    } catch { /* не критично — остаётся ручной рескан по r */ }
  }

  const cleanup = () => { exitTui(); process.exit(0); };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
};

main();
