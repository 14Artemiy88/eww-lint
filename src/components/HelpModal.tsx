import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onTrySample: () => void;
}

const STEPS: { n: string; title: string; text: string; hint?: string }[] = [
  {
    n: "01",
    title: "Вставьте конфиг",
    text: "Откройте ~/.config/eww/eww.yuck и ~/.config/eww/eww.scss, скопируйте содержимое в редакторы слева. Или жмите «Импорт» и выберите файлы (можно несколько) — они попадут на нужные вкладки.",
    hint: "cat ~/.config/eww/eww.yuck | wl-copy",
  },
  {
    n: "02",
    title: "Подключите вложенные файлы",
    text: "Если конфиг разбит на части — (include \"src/_volumes.yuck\") — подключите их кнопками «+ файл» (импорт .yuck) или «вставить» (путь + содержимое). Анализатор проверит все файлы, разрешит пути include, найдёт циклы и дубли определений между файлами.",
    hint: "ls ~/.config/eww/src/*.yuck",
  },
  {
    n: "03",
    title: "Проверка идёт сама",
    text: "Анализ перезапускается автоматически через секунду после правок (или Ctrl+Enter вручную). Ничего никуда не отправляется — всё считается в браузере.",
  },
  {
    n: "04",
    title: "Разберите находки",
    text: "Справа — список проблем по серьёзности: ошибки, предупреждения, советы. Клик по номеру строки переносит прямо к проблемному месту в редакторе и подсвечивает его.",
  },
  {
    n: "05",
    title: "Примените фиксы",
    text: "У каждой находки есть готовый исправленный фрагмент — копируйте кнопкой «фикс» и вставляйте в свой конфиг. Индекс оптимизации и счётчик «обн/мин» покажут эффект.",
  },
];

export default function HelpModal({ open, onClose, onTrySample }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Как пользоваться"
    >
      <div
        className="animate-toast-in relative w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1 w-full bg-gradient-to-r from-amber via-amber/40 to-transparent" />
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 className="font-display text-lg font-black tracking-tight text-fg">
              Как пользоваться <span className="text-amber">eww·lint</span>
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-mut">
              Пять шагов от «вот мой конфиг» до «вот что в нём тормозит и как исправить» — включая вложенные файлы
              из include.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-lg border border-line p-2 text-dim transition-all duration-200 hover:border-line2 hover:text-fg active:scale-90"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto scroll-slim px-6 py-5">
          <ol className="space-y-4">
            {STEPS.map((s, i) => (
              <li
                key={s.n}
                className="animate-fade-up flex gap-4 rounded-xl border border-line/70 bg-ink/50 p-4"
                style={{ animationDelay: `${80 + i * 70}ms` }}
              >
                <span className="font-display mt-0.5 text-sm font-black text-amber/80">{s.n}</span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-fg">{s.title}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-mut">{s.text}</p>
                  {s.hint && (
                    <code className="mt-2 block w-fit rounded-md border border-line bg-ink px-2.5 py-1.5 font-mono text-[11.5px] text-mint">
                      {s.hint}
                    </code>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="animate-fade-up mt-4 rounded-xl border border-line2/60 bg-raised p-4" style={{ animationDelay: "380ms" }}>
            <div className="text-[12px] font-bold tracking-wide text-amber">Что инструмент ищет в первую очередь</div>
            <ul className="mt-2 grid gap-1.5 text-[12.5px] text-mut">
              <li className="flex gap-2"><span className="text-coral">•</span>defpoll с интервалом меньше секунды — главный источник нагрузки на CPU</li>
              <li className="flex gap-2"><span className="text-amber">•</span>поллинг вместо событий (pactl subscribe, playerctl -F, udevadm)</li>
              <li className="flex gap-2"><span className="text-amber">•</span>busy-loop в deflisten: while true без sleep сжигает ядро</li>
              <li className="flex gap-2"><span className="text-sky">•</span>тяжёлые стили: blur, большие тени, вложенность &gt; 4, hover без transition</li>
              <li className="flex gap-2"><span className="text-viol">•</span>неразрешённые include, циклы include, дубли определений между файлами</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-ink/60 px-6 py-4">
          <span className="text-[11.5px] text-dim">
            Конфидициально: код анализируется локально, никуда не отправляется.
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onTrySample();
                onClose();
              }}
              className="rounded-lg border border-amber/50 px-3.5 py-2 text-[12.5px] font-bold text-amber transition-all duration-200 hover:bg-amber/10 active:scale-95"
            >
              Загрузить пример
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-amber px-4 py-2 text-[12.5px] font-bold text-ink transition-all duration-200 hover:bg-amber2 active:scale-95"
            >
              Понятно
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
