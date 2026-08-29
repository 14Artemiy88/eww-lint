export type Severity = "error" | "warning" | "hint";
export type FileKind = "yuck" | "scss";

export interface Diagnostic {
  id: string;
  /** Путь файла: "eww.yuck", "eww.scss" или путь подключённого файла, например "src/_volumes.yuck" */
  file: string;
  line: number;
  severity: Severity;
  tag: string;
  title: string;
  detail: string;
  fix?: string;
}

export interface MountedFile {
  id: string;
  path: string;
  content: string;
}

export interface Stats {
  windows: number;
  widgets: number;
  polls: number;
  listens: number;
  vars: number;
  updatesPerMin: number;
  files: number;
  includesTotal: number;
  includesResolved: number;
}

export interface Analysis {
  diagnostics: Diagnostic[];
  score: number;
  grade: string;
  stats: Stats;
  /** пути подключённых файлов, на которые есть include */
  filesUsed: string[];
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const lineOf = (src: string, idx: number) =>
  src.slice(0, idx).split("\n").length;

const parseInterval = (raw: string): number | null => {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2] ?? "s";
  if (unit === "ms") return v / 1000;
  if (unit === "m") return v * 60;
  return v;
};

/** Находит закрывающую скобку s-выражения, открытого в openIdx. */
const closeSexpr = (src: string, openIdx: number): number => {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === ";" ) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === '"' || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
};

interface Block {
  kind: string;
  name: string;
  idx: number;
  line: number;
  body: string;
}

const findBlocks = (src: string): Block[] => {
  const out: Block[] = [];
  const re = /\(\s*(defpoll|deflisten|defvar|defwidget|defwindow)\s+([A-Za-z0-9_.$-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = closeSexpr(src, m.index);
    const body = end > 0 ? src.slice(m.index + 1, end) : src.slice(m.index + 1, m.index + 400);
    out.push({
      kind: m[1],
      name: m[2],
      idx: m.index,
      line: lineOf(src, m.index),
      body,
    });
  }
  return out;
};

const lastCommand = (body: string): string => {
  const backticks = [...body.matchAll(/`([^`]*)`/g)];
  if (backticks.length) return backticks[backticks.length - 1][1];
  const quotes = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  if (quotes.length) return quotes[quotes.length - 1][1];
  return "";
};

/* ------------------------------------------------------------------ */
/* YUCK rules                                                          */
/* ------------------------------------------------------------------ */

const LISTENABLE: { re: RegExp; title: string; detail: string; fix: string }[] = [
  {
    re: /pamixer|amixer\s+get|pactl\s+get|wpctl\s+get-volume/,
    title: "Громкость меняется по событию — слушайте, а не опрашивайте",
    detail:
      "PulseAudio/PipeWire сами сообщают об изменении громкости. deflisten с pactl subscribe реагирует мгновенно и не будит shell каждые N секунд.",
    fix: `(deflisten volume :initial "0"
  \`pactl subscribe | while read -r _; do pamixer --get-volume; done\`)`,
  },
  {
    re: /playerctl\s+metadata|playerctl\s+status/,
    title: "playerctl умеет стримить изменения — опрос не нужен",
    detail:
      "Флаг -F (follow) выводит новую строку при каждой смене трека/статуса. Это и быстрее, и точнее: пауза видна сразу, а не через интервал.",
    fix: `(deflisten player :initial ""
  \`playerctl -a metadata --format "{{artist}} — {{title}}" -F\`)`,
  },
  {
    re: /power_supply\/BAT|upower\s+-i/,
    title: "Батарея шлёт uevent'ы — перейдите на udevadm",
    detail:
      "cat /sys/... раз в 2 секунды — 30 лишних fork'ов в минуту. udevadm monitor отдаёт строку ровно тогда, когда заряд изменился.",
    fix: `(deflisten battery :initial "100"
  \`udevadm monitor --subsystem-match=power_supply | while read -r _; do cat /sys/class/power_supply/BAT0/capacity; done\`)`,
  },
  {
    re: /iwgetid|nmcli\s+(d|dev)\s+wifi|ip\s+(addr|link)/,
    title: "Состояние сети — событийное, не поллится",
    detail:
      "NetworkManager публикует события в dbus; nmcli monitor (или udevadm по подсистеме net) сообщит о смене SSID сам.",
    fix: `(deflisten net :initial ""
  \`udevadm monitor --subsystem-match=net | while read -r _; do iwgetid -r; done\`)`,
  },
];

const analyzeYuck = (
  src: string,
  diags: Diagnostic[],
  filePath: string,
  allYuckSrc: string
): Stats => {
  const stats: Stats = {
    windows: 0,
    widgets: 0,
    polls: 0,
    listens: 0,
    vars: 0,
    updatesPerMin: 0,
    files: 0,
    includesTotal: 0,
    includesResolved: 0,
  };
  if (!src.trim()) return stats;

  let uid = 0;
  const push = (d: Omit<Diagnostic, "id" | "file">) =>
    diags.push({ id: `y-${filePath}-${++uid}`, file: filePath, ...d });

  /* баланс скобок */
  let open = 0;
  let closed = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (c === ";") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "(") open++;
    if (c === ")") closed++;
  }
  if (open !== closed) {
    push({
      line: src.split("\n").length,
      severity: "error",
      tag: "синтаксис",
      title: "Скобки не сбалансированы",
      detail: `Открывающих «(» — ${open}, закрывающих «)» — ${closed}. eww откажется парсить файл целиком, остальные проверки могут быть неточными.`,
    });
  }

  const blocks = findBlocks(src);
  /* дубликаты имён (в т.ч. между файлами) проверяются на уровне проекта */

  /* defpoll */
  const pollCommands = new Map<string, number>();
  for (const b of blocks) {
    if (b.kind === "defpoll") {
      stats.polls++;
      const cmd = lastCommand(b.body);
      const intMatch = b.body.match(/:interval\s*"([^"]+)"/);

      if (!intMatch) {
        push({
          line: b.line,
          severity: "error",
          tag: "синтаксис",
          title: `defpoll «${b.name}» без :interval`,
          detail: "У defpoll интервал обязателен — без него eww бросит ошибку при загрузке конфига.",
          fix: `(defpoll ${b.name} :interval "5s" \`...\`)`,
        });
        continue;
      }

      const sec = parseInterval(intMatch[1]);
      if (sec === null) {
        push({
          line: b.line,
          severity: "error",
          tag: "синтаксис",
          title: `Не удалось разобрать интервал «${intMatch[1]}»`,
          detail: "Поддерживаются форматы \"500ms\", \"1s\", \"5m\". Проверьте значение :interval.",
        });
        continue;
      }

      stats.updatesPerMin += 60 / sec;

      if (sec < 0.3) {
        push({
          line: b.line,
          severity: "error",
          tag: "производительность",
          title: `Опрос каждые ${intMatch[1]} — ${Math.round(60 / sec)} запусков shell в минуту`,
          detail:
            "Каждый тик defpoll — это fork shell + запуск команды + парсинг вывода + перерисовка виджета. Быстрее 1s оправданы только анимации; данные так быстро не меняются.",
          fix: `(defpoll ${b.name} :interval "1s" \`...\`)`,
        });
      } else if (sec < 1) {
        push({
          line: b.line,
          severity: "warning",
          tag: "производительность",
          title: `Интервал ${intMatch[1]} избыточен`,
          detail:
            "Для текста и цифр 1s визуально неотличима от 0.5s, но вдвое дешевле по CPU. Оставьте субсекундные интервалы только для плавных анимаций.",
          fix: `(defpoll ${b.name} :interval "1s" \`...\`)`,
        });
      }

      if (/\bdate\b/.test(cmd) && sec < 1) {
        push({
          line: b.line,
          severity: "warning",
          tag: "производительность",
          title: "Часы достаточно обновлять раз в секунду",
          detail: "Секунды в строке — максимум, что видно; при :interval \"1s\" команда date стартует ровно в такт смене секунд.",
          fix: `(defpoll ${b.name} :interval "1s" \`date '+%H:%M:%S'\`)`,
        });
      }

      for (const rule of LISTENABLE) {
        if (rule.re.test(cmd)) {
          push({
            line: b.line,
            severity: "warning",
            tag: "производительность",
            title: rule.title,
            detail: rule.detail,
            fix: rule.fix,
          });
          break;
        }
      }

      if (/curl|wget|nc\s/.test(cmd)) {
        push({
          line: b.line,
          severity: sec < 300 ? "warning" : "hint",
          tag: "сеть",
          title: `Сетевой запрос в опросе каждые ${intMatch[1]}`,
          detail:
            "Каждый тик поднимает TLS-соединение: трафик, батарея, риск упереться в rate-limit. Кэшируйте ответ в файл и читайте файл, либо поднимите интервал до минут.",
          fix: `(defpoll ${b.name} :interval "10m" \`...\`)`,
        });
      }

      if (/convert |ffmpeg|magick /.test(cmd) && sec < 5) {
        push({
          line: b.line,
          severity: "warning",
          tag: "производительность",
          title: "Тяжёлая обработка изображения на каждом тике",
          detail:
            "convert/ffmpeg запускаются чаще, чем меняется исходник. Регенерируйте картинку по событию (смена трека) через deflisten, а виджет пусть просто читает готовый файл.",
          fix: `(deflisten cover \`playerctl -a metadata mpris:artUrl -F | while read -r u; do ... convert ...; echo /tmp/cover.png; done\`)`,
        });
      }

      if (/eww\s+update/.test(cmd)) {
        push({
          line: b.line,
          severity: "hint",
          tag: "структура",
          title: "«eww update» внутри скрипта — лишний процесс",
          detail:
            "defpoll уже передаёт stdout переменной. Вызов eww update порождает ещё один клиент и IPC-раунд; просто выводите значение в stdout.",
          fix: "# вместо `...; eww update x \"$v\"` — просто `echo \"$v\"` в stdout",
        });
      }

      if (cmd.length > 160) {
        push({
          line: b.line,
          severity: "hint",
          tag: "структура",
          title: "Длинный инлайн-скрипт в defpoll",
          detail:
            "Скрипты длиннее пары команд лучше выносить в ~/.config/eww/scripts/ — yuck остаётся читаемым, а скрипт можно отлаживать и переиспользовать отдельно.",
          fix: `(defpoll ${b.name} :interval "${intMatch[1]}" \`~/.config/eww/scripts/${b.name}.sh\`)`,
        });
      }

      const key = cmd.replace(/\s+/g, " ").trim();
      if (pollCommands.has(key)) {
        push({
          line: b.line,
          severity: "warning",
          tag: "структура",
          title: "Два defpoll запускают одну и ту же команду",
          detail: `Та же команда уже выполняется в defpoll на строке ${pollCommands.get(key)}. Двойной fork бессмыслен: оставьте один опрос и ссылайтесь на его переменную из обоих виджетов.`,
        });
      } else {
        pollCommands.set(key, b.line);
      }
    }
  }

  /* deflisten */
  for (const b of blocks) {
    if (b.kind === "deflisten") {
      stats.listens++;
      const cmd = lastCommand(b.body);
      if (/\b(while|until)\b|; do\b/.test(cmd) && !/sleep|read\s+-r|inotifywait|subscribe|monitor|udevadm|-F\b|--follow|wait\s/.test(cmd)) {
        push({
          line: b.line,
          severity: "error",
          tag: "производительность",
          title: "Busy-loop в deflisten: цикл без паузы и без блокирующего чтения",
          detail:
            "while true без sleep/read крутит ядро на 100% одного ядра — скрипт перезапускает команду тысячи раз в секунду. Добавьте sleep, блокирующий read или перейдите на подписку.",
          fix: `# минимально: вставьте sleep в цикл
while true; do cat /sys/class/power_supply/BAT0/capacity; sleep 2; done`,
        });
      }
    }
  }

  /* окна */
  for (const b of blocks) {
    if (b.kind === "defwindow") {
      stats.windows++;
      if (!/:geometry/.test(b.body)) {
        push({
          line: b.line,
          severity: "warning",
          tag: "разметка",
          title: `У окна «${b.name}» нет :geometry`,
          detail:
            "Без явной геометрии окно может растянуться на весь экран или встать не туда — зависит от WM. Для бара достаточно задать ширину 100% и высоту в пикселях.",
          fix: `:geometry (geometry :x "0%" :y "0%" :width "100%" :height "34px" :anchor "top center")`,
        });
      }
      if (/bar|panel|dock|status/i.test(b.name) && !/:exclusive\s+true/.test(b.body)) {
        push({
          line: b.line,
          severity: "hint",
          tag: "разметка",
          title: "Бар стоит сделать :exclusive true",
          detail:
            "exclusive-окно просит WM зарезервировать под него место: максимизированные и тайловые окна перестанут заезжать под бар.",
          fix: `:exclusive true`,
        });
      }
    }
  }

  /* неиспользуемые определения */
  for (const b of blocks) {
    if (b.kind === "defvar" || b.kind === "defwidget") {
      if (b.kind === "defvar") stats.vars++;
      if (b.kind === "defwidget") stats.widgets++;
      const bare = b.name.replace(/^\$/, "");
      const reName = new RegExp(`(^|[^A-Za-z0-9_-])${bare.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?![A-Za-z0-9_-])`, "g");
      /* ищем использования по всем файлам проекта, а не только в своём */
      const total = (allYuckSrc.match(reName) ?? []).length;
      if (total <= 1) {
        push({
          line: b.line,
          severity: "hint",
          tag: "структура",
          title: `«${bare}» нигде не используется`,
          detail:
            b.kind === "defvar"
              ? "Переменная определена, но ни один виджет её не читает. Мёртвый код путает при рефакторинге — удалите или подключите."
              : "Виджет определён, но ни одно окно его не рендерит. Удалите или добавьте в defwindow.",
        });
      }
    }
  }

  stats.updatesPerMin = Math.round(stats.updatesPerMin);
  return stats;
};

/* ------------------------------------------------------------------ */
/* SCSS rules                                                          */
/* ------------------------------------------------------------------ */

const analyzeScss = (src: string, diags: Diagnostic[]): void => {
  if (!src.trim()) return;
  let uid = 0;
  const push = (d: Omit<Diagnostic, "id" | "file">) =>
    diags.push({ id: `s${++uid}`, file: "eww.scss", ...d });

  const lines = src.split("\n");

  /* глубина вложенности */
  let depth = 0;
  let flagged = false;
  lines.forEach((ln, i) => {
    if (/^\s*(\/\/|\/\*)/.test(ln)) return;
    for (const ch of ln) {
      if (ch === "{") depth++;
      if (ch === "}") depth = Math.max(0, depth - 1);
    }
    if (depth > 4 && !flagged) {
      flagged = true;
      push({
        line: i + 1,
        severity: "hint",
        tag: "стиль",
        title: "Вложенность селекторов глубже 4 уровней",
        detail:
          "Глубокая вложенность порождает длинные селекторы, которые дороже матчить при каждой перерисовке виджета, и усложняет переопределения. Вынесите внутренние блоки наверх (BEM-стиль: .bar__icon).",
      });
    }
  });

  /* повторяющиеся hex-цвета */
  const hexes = new Map<string, number>();
  for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const h = m[0].toLowerCase();
    hexes.set(h, (hexes.get(h) ?? 0) + 1);
  }
  for (const [hex, n] of hexes) {
    if (n >= 3) {
      const idx = src.indexOf(hex);
      push({
        line: lineOf(src, idx),
        severity: "hint",
        tag: "стиль",
        title: `Цвет ${hex} повторяется ${n} раз`,
        detail:
          "Одна $переменная на цвет — и смена темы превращается в правку одной строки, а не в grep по файлу.",
        fix: `$accent: ${hex};\n... color: $accent;`,
      });
    }
  }

  /* hover без transition */
  if (/:hover/.test(src) && !/transition/.test(src)) {
    const idx = src.search(/:hover/);
    push({
      line: lineOf(src, idx),
      severity: "hint",
      tag: "ux",
      title: "Hover-эффект без transition",
      detail:
        "Без transition цвет переключается рывком. 120–180ms ease на color/background делают интерфейс заметно «живее» почти бесплатно.",
      fix: `transition: color 150ms ease, background-color 150ms ease;`,
    });
  }

  /* тяжёлые тени и blur */
  lines.forEach((ln, i) => {
    if (/box-shadow/.test(ln)) {
      const nums = [...ln.matchAll(/(\d{2,3})px/g)].map((m) => parseInt(m[1]));
      if (nums.some((n) => n >= 30)) {
        push({
          line: i + 1,
          severity: "warning",
          tag: "производительность",
          title: "box-shadow с blur ≥ 30px",
          detail:
            "Большие тени композитор пересчитывает при каждой перерисовке окна. На тёмном фоне достаточно 8–16px — визуально разница минимальна, нагрузка заметно ниже.",
          fix: ln.replace(/(\d{2,3})px/g, (s) => `${Math.min(parseInt(s), 16)}px`).trim(),
        });
      }
    }
    const blur = ln.match(/(?:backdrop-)?filter\s*:[^;]*blur\(\s*(\d+)/);
    if (blur && parseInt(blur[1]) > 0) {
      push({
        line: i + 1,
        severity: "warning",
        tag: "производительность",
        title: `blur(${blur[1]}px) — дорогой фильтр`,
        detail:
          "Размытие фона пересчитывается каждый кадр при любой анимации поверх окна. Снизьте до 8–12px или замените полупрозрачной подложкой: на тёмной теме эффект почти неразличим.",
        fix: `backdrop-filter: blur(10px);`,
      });
    }
  });

  /* универсальный селектор */
  const starIdx = src.search(/^\s*\*[\s,{]/m);
  if (starIdx >= 0) {
    push({
      line: lineOf(src, starIdx),
      severity: "hint",
      tag: "стиль",
      title: "Селектор * применяется ко всем элементам",
      detail:
        "«* { all: unset }» матчится на каждый узел дерева при каждой перерисовке. Для сброса стилей eww чаще достаточно обнулить конкретные классы.",
    });
  }

  /* !important */
  const imps = [...src.matchAll(/!important/g)];
  if (imps.length >= 3) {
    push({
      line: lineOf(src, imps[0].index ?? 0),
      severity: "hint",
      tag: "стиль",
      title: `!important используется ${imps.length} раза`,
      detail:
        "Несколько !important подряд — признак борьбы со специфичностью. Упростите селекторы или поднимите правила в конец файла — important станет не нужен.",
    });
  }

  /* темы без переменных */
  if (lines.length > 80 && !/\$[\w-]+\s*:/.test(src)) {
    push({
      line: 1,
      severity: "hint",
      tag: "стиль",
      title: "Большой файл без SCSS-переменных",
      detail: "Вынесите палитру в переменные в начале файла — правка темы станет однострочной, а повторяющиеся значения исчезнут.",
    });
  }
};

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

const SEVERITY_WEIGHT: Record<Severity, number> = { error: 10, warning: 5, hint: 2 };
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, hint: 2 };

const normalizePath = (p: string) => p.replace(/^\.\//, "").replace(/\/{2,}/g, "/").trim();
const baseName = (p: string) => p.split("/").pop() ?? p;

interface IncludeRef {
  fromPath: string;
  target: string;
  line: number;
  resolved: string | null;
}

export const analyze = (rootYuck: string, scss: string, mounted: MountedFile[] = []): Analysis => {
  const diagnostics: Diagnostic[] = [];
  let uid = 0;
  const push = (d: Omit<Diagnostic, "id">) => diagnostics.push({ id: `p${++uid}`, ...d });

  const files = [
    { path: "eww.yuck", content: rootYuck },
    ...mounted.map((m) => ({ path: normalizePath(m.path) || `файл-${m.id}.yuck`, content: m.content })),
  ];
  const allYuckSrc = files.map((f) => f.content).join("\n");

  /* --- include: разбор, разрешение путей, циклы --- */
  const includes: IncludeRef[] = [];
  const resolve = (target: string, selfPath: string): string | null => {
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
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content))) {
      includes.push({ fromPath: f.path, target: m[1], line: lineOf(f.content, m.index), resolved: resolve(m[1], f.path) });
    }
  }

  for (const inc of includes) {
    if (!inc.resolved) {
      push({
        file: inc.fromPath,
        line: inc.line,
        severity: "warning",
        tag: "include",
        title: `include «${inc.target}» не найден среди подключённых файлов`,
        detail:
          "eww ищет путь относительно ~/.config/eww. Подключите файл кнопкой «+ файл» или «Вставить» — анализатор разберёт и его. Пока файл не подключён, все определения из него не учитываются.",
        fix: `(include "${inc.target}")  ; убедитесь, что путь указан от корня ~/.config/eww`,
      });
    }
  }

  /* циклы и глубина цепочек include (DFS по графу файлов) */
  const graph = new Map<string, IncludeRef[]>();
  for (const inc of includes) {
    if (!inc.resolved) continue;
    if (!graph.has(inc.fromPath)) graph.set(inc.fromPath, []);
    graph.get(inc.fromPath)!.push(inc);
  }
  const walk = (node: string, stack: string[]): void => {
    for (const inc of graph.get(node) ?? []) {
      const next = inc.resolved!;
      const at = stack.indexOf(next);
      if (at >= 0) {
        push({
          file: inc.fromPath,
          line: inc.line,
          severity: "error",
          tag: "include",
          title: "Цикл include: файл включает сам себя через цепочку",
          detail: `Цепочка: ${[...stack.slice(at), next].join(" → ")}. eww зациклится при загрузке конфига — уберите один из include.`,
          fix: `; удалите строку (include "${inc.target}") в одном из файлов цепочки`,
        });
        continue;
      }
      if (stack.length >= 5) {
        push({
          file: inc.fromPath,
          line: inc.line,
          severity: "hint",
          tag: "include",
          title: "Цепочка include глубже 5 уровней",
          detail: "Слишком глубокая вложенность файлов усложняет поиск определений. Стоит уплощить структуру: 2–3 уровня обычно достаточно.",
        });
        continue;
      }
      walk(next, [...stack, next]);
    }
  };
  walk("eww.yuck", ["eww.yuck"]);

  /* подключённые, но ниоткуда не включённые файлы */
  const referenced = new Set(includes.map((i) => i.resolved).filter(Boolean) as string[]);
  for (const f of files) {
    if (f.path === "eww.yuck") continue;
    if (!referenced.has(f.path)) {
      push({
        file: f.path,
        line: 1,
        severity: "hint",
        tag: "include",
        title: "Файл подключён к анализу, но ни один include на него не ссылается",
        detail: `Добавьте (include "${f.path}") в eww.yuck, иначе eww не увидит определения из этого файла. Если файл не нужен — отключите его (× на вкладке).`,
        fix: `(include "${f.path}")`,
      });
    }
  }

  /* --- дубликаты определений между файлами --- */
  const seen = new Map<string, { path: string; line: number }>();
  for (const f of files) {
    for (const b of findBlocks(f.content)) {
      const key = `${b.kind}:${b.name}`;
      const first = seen.get(key);
      if (first) {
        push({
          file: f.path,
          line: b.line,
          severity: "error",
          tag: "структура",
          title: `Повторное определение «${b.name}»`,
          detail: `Первое определение — ${first.path}, стр. ${first.line}. eww возьмёт то, что загрузится последним: при include порядок неочевиден. Оставьте одно определение.`,
        });
      } else {
        seen.set(key, { path: f.path, line: b.line });
      }
    }
  }

  /* --- правила каждого yuck-файла --- */
  const stats: Stats = {
    windows: 0,
    widgets: 0,
    polls: 0,
    listens: 0,
    vars: 0,
    updatesPerMin: 0,
    files: files.length,
    includesTotal: includes.length,
    includesResolved: includes.filter((i) => i.resolved).length,
  };
  for (const f of files) {
    const st = analyzeYuck(f.content, diagnostics, f.path, allYuckSrc);
    stats.windows += st.windows;
    stats.widgets += st.widgets;
    stats.polls += st.polls;
    stats.listens += st.listens;
    stats.vars += st.vars;
    stats.updatesPerMin += st.updatesPerMin;
  }

  analyzeScss(scss, diagnostics);

  /* сортировка: серьёзность → порядок файлов (корень, подключённые, scss) → строка */
  const order = new Map<string, number>(files.map((f, i) => [f.path, i]));
  order.set("eww.scss", files.length);
  diagnostics.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (order.get(a.file) ?? 99) - (order.get(b.file) ?? 99) ||
      a.line - b.line
  );

  const penalty = diagnostics.reduce((s, d) => s + SEVERITY_WEIGHT[d.severity], 0);
  const score = diagnostics.length === 0 ? 100 : Math.max(4, 100 - penalty);
  const grade =
    score >= 85 ? "отлично" : score >= 65 ? "хорошо" : score >= 40 ? "средне" : "требует работы";

  return { diagnostics, score, grade, stats, filesUsed: [...referenced] };
};
