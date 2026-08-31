import { useEffect } from "react";
import TUI_SOURCE from "../../eww-lint.tui.mjs?raw";

interface Props {
  open: boolean;
  onClose: () => void;
  onCopy: (text: string, label: string) => void;
  onDownloaded: (msg: string) => void;
}

const KEYS: [string, string][] = [
  ["↑↓ / jk", "навигация по файлам и находкам"],
  ["tab / h l", "смена панели"],
  ["enter", "открыть находку в $EDITOR на нужной строке"],
  ["f", "фильтр: все → ошибки → предупреждения → советы"],
  ["0 1 2 3", "фильтр по серьёзности"],
  ["r", "пересканировать"],
  ["q / esc", "выход"],
];

export default function TuiModal({ open, onClose, onCopy, onDownloaded }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const download = () => {
    const blob = new Blob([TUI_SOURCE], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "eww-lint.tui.mjs";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onDownloaded("eww-lint.tui.mjs сохранён — запускайте: node eww-lint.tui.mjs");
  };

  const cmd = "node eww-lint.tui.mjs ~/.config/eww";
  const size = `${Math.round(TUI_SOURCE.length / 1024)} КБ`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="TUI-версия"
    >
      <div
        className="animate-toast-in relative flex max-h-[88vh] w-full max-w-[620px] flex-col overflow-hidden border border-line2 bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(76,224,127,0.07)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* terminal title bar */}
        <div className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-coral/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-mint/80" />
          <span className="ml-2 font-mono text-[11.5px] font-semibold text-mut">
            eww-lint.tui.mjs — bash — 80×24
          </span>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="ml-auto border border-line p-1.5 text-dim transition-colors hover:border-line2 hover:text-fg"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <h2 className="font-display text-[19px] font-black tracking-tight text-fg">
            TUI-версия: <span className="text-mint">полный доступ к файлам</span>
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-mut">
            Никаких вставок и выбора папок. Скрипт читает{" "}
            <code className="border border-line bg-ink px-1.5 py-0.5 font-mono text-[12px] text-mint">~/.config/eww</code>{" "}
            напрямую, рекурсивно обходит все подпапки, строит include-граф и прогоняет те же 33 правила. Один файл,{" "}
            <b className="text-fg">Node ≥ 18, ноль зависимостей</b>.
          </p>

          {/* запуск */}
          <div className="mt-4 border border-line bg-ink">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
              <span className="text-[10.5px] font-bold tracking-widest text-dim uppercase">запуск</span>
              <button
                onClick={() => onCopy(cmd, "Команда запуска скопирована")}
                className="text-[10.5px] font-semibold text-mut transition-colors hover:text-mint"
              >
                [ копировать ]
              </button>
            </div>
            <pre className="overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed">
              <span className="text-dim">$ </span>
              <span className="text-fg">{cmd}</span>
              {"\n"}
              <span className="text-dim">$ </span>
              <span className="text-mut">node eww-lint.tui.mjs --report</span>
              <span className="text-dim">   # отчёт для CI, exit 1 при ошибках</span>
              {"\n"}
              <span className="text-dim">$ </span>
              <span className="text-mut">node eww-lint.tui.mjs --json</span>
              <span className="text-dim">     # машиночитаемый вывод</span>
            </pre>
          </div>

          {/* клавиши */}
          <div className="mt-4">
            <div className="text-[10.5px] font-bold tracking-widest text-dim uppercase">клавиши</div>
            <div className="mt-2 space-y-1.5">
              {KEYS.map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-3 text-[12.5px]">
                  <span className="keycap min-w-[86px] text-center">{k}</span>
                  <span className="text-mut">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* возможности */}
          <div className="mt-4 border border-line bg-ink/60 p-3.5">
            <div className="text-[10.5px] font-bold tracking-widest text-dim uppercase">внутри</div>
            <ul className="mt-2 space-y-1 text-[12.5px] text-mut">
              <li><span className="text-mint">▸</span> автообновление: правите файл — TUI пересканирует конфиг сам (fs.watch)</li>
              <li><span className="text-mint">▸</span> enter открывает находку в <span className="text-fg">$EDITOR</span> сразу на проблемной строке (nvim, vim, nano, code --goto)</li>
              <li><span className="text-mint">▸</span> все 33 правила: defpoll/deflisten, busy-loop, include-граф, дубли, scss-стили</li>
              <li><span className="text-mint">▸</span> индекс оптимизации, обн/мин, счётчики по файлам — в шапке экрана</li>
            </ul>
          </div>
        </div>

        {/* футер модала */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-raised px-6 py-4">
          <span className="font-mono text-[11px] text-dim">
            {size} · MIT · Node ≥ 18 · без зависимостей
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onCopy(TUI_SOURCE, "Исходник TUI скопирован")}
              className="border border-line px-3.5 py-2 font-mono text-[12px] font-bold text-mut transition-all hover:border-line2 hover:text-fg active:scale-95"
            >
              [ исходник ]
            </button>
            <button
              onClick={download}
              className="border border-mint/60 bg-mint/15 px-4 py-2 font-mono text-[12px] font-bold text-mint transition-all hover:bg-mint/25 active:scale-95"
            >
              ⭳ скачать eww-lint.tui.mjs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
