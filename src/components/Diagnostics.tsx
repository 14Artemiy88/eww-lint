import { useState } from "react";
import type { Analysis, Diagnostic, Severity } from "../lib/analyzer";

export type Filter = "all" | Severity;

interface Props {
  analysis: Analysis | null;
  loading: boolean;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onJump: (d: Diagnostic) => void;
  onCopy: (text: string, label: string) => void;
  inputsEmpty?: boolean;
}

const SEV_META: Record<Severity, { label: string; color: string; ring: string }> = {
  error: { label: "Ошибка", color: "#ff7b72", ring: "border-l-coral" },
  warning: { label: "Предупреждение", color: "#f2b04e", ring: "border-l-amber" },
  hint: { label: "Совет", color: "#6fb7ff", ring: "border-l-sky" },
};

function SevIcon({ sev }: { sev: Severity }) {
  const c = SEV_META[sev].color;
  if (sev === "error")
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
      </svg>
    );
  if (sev === "warning")
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4 2.8 19.5h18.4L12 4z" />
        <path d="M12 10v4.2M12 17.2v.1" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1.4-1 2.5h-6c0-1.1-.3-1.9-1-2.5A6 6 0 0 1 12 3z" />
    </svg>
  );
}

function CopyFix({ text, onCopy }: { text: string; onCopy: (t: string, l: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onCopy(text, "Фикс скопирован в буфер");
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="absolute -top-2.5 right-2 flex items-center gap-1 rounded-md border border-line bg-raised px-2 py-0.5 text-[10.5px] font-semibold text-mut transition-all duration-200 hover:border-line2 hover:text-fg active:scale-95"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" className="h-3 w-3 text-mint" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
      )}
      {copied ? "готово" : "копировать"}
    </button>
  );
}

export default function Diagnostics({ analysis, loading, filter, onFilter, onJump, onCopy, inputsEmpty }: Props) {
  const all = analysis?.diagnostics ?? [];
  const counts = {
    all: all.length,
    error: all.filter((d) => d.severity === "error").length,
    warning: all.filter((d) => d.severity === "warning").length,
    hint: all.filter((d) => d.severity === "hint").length,
  };
  const visible = filter === "all" ? all : all.filter((d) => d.severity === filter);

  const chips: { key: Filter; label: string; n: number; dot?: string }[] = [
    { key: "all", label: "Все", n: counts.all },
    { key: "error", label: "Ошибки", n: counts.error, dot: "#ff7b72" },
    { key: "warning", label: "Предупр.", n: counts.warning, dot: "#f2b04e" },
    { key: "hint", label: "Советы", n: counts.hint, dot: "#6fb7ff" },
  ];

  const upm = analysis?.stats.updatesPerMin ?? 0;
  const upmColor = upm > 120 ? "#ff7b72" : upm > 40 ? "#f2b04e" : "#55d6a0";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="border-b border-line px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[13px] font-bold tracking-wide text-fg">Диагностика</h2>
          {!loading && analysis && (
            <span className="text-[11px] text-dim">
              {all.length === 0 ? "проблем нет" : `${all.length} ${all.length === 1 ? "находка" : all.length < 5 ? "находки" : "находок"}`}
            </span>
          )}
        </div>

        {/* metrics */}
        {analysis && !loading && (
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {[
              { k: "окна", v: analysis.stats.windows },
              { k: "виджеты", v: analysis.stats.widgets },
              { k: "defpoll", v: analysis.stats.polls },
              { k: "deflisten", v: analysis.stats.listens },
            ].map((s) => (
              <div key={s.k} className="rounded-lg border border-line/70 bg-ink/50 px-1 py-1.5 text-center">
                <div className="font-mono text-sm font-bold text-fg tabular-nums">{s.v}</div>
                <div className="text-[9.5px] font-medium text-dim">{s.k}</div>
              </div>
            ))}
            <div className="rounded-lg border px-1 py-1.5 text-center" style={{ borderColor: upmColor + "55", background: upmColor + "12" }}>
              <div className="font-mono text-sm font-bold tabular-nums" style={{ color: upmColor }}>
                {upm > 999 ? "999+" : upm}
              </div>
              <div className="text-[9.5px] font-medium" style={{ color: upmColor }}>
                обн/мин
              </div>
            </div>
          </div>
        )}

        {/* include-сводка */}
        {analysis && !loading && analysis.stats.includesTotal > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-line/70 bg-ink/50 px-2.5 py-1.5 text-[11px] text-mut">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M10 13.5 8.5 15l1.5 1.5M14 13.5l1.5 1.5L14 16.5" />
            </svg>
            <span>
              файлов: <b className="font-mono text-fg">{analysis.stats.files}</b>
            </span>
            <span className="text-dim">·</span>
            <span>
              include:{" "}
              <b
                className="font-mono"
                style={{
                  color:
                    analysis.stats.includesResolved === analysis.stats.includesTotal ? "#55d6a0" : "#f2b04e",
                }}
              >
                {analysis.stats.includesResolved}/{analysis.stats.includesTotal}
              </b>
            </span>
            {analysis.stats.includesResolved < analysis.stats.includesTotal && (
              <span className="font-semibold text-amber">— есть неразрешённые</span>
            )}
          </div>
        )}

        {/* filters */}
        <div className="mt-3 flex gap-1.5">
          {chips.map((c) => {
            const active = filter === c.key;
            return (
              <button
                key={c.key}
                onClick={() => onFilter(c.key)}
                className={
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 active:scale-95 " +
                  (active
                    ? "border-amber/60 bg-amber/15 text-amber"
                    : "border-line bg-transparent text-mut hover:border-line2 hover:text-fg")
                }
              >
                {c.dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />}
                {c.label}
                <span className={active ? "text-amber" : "text-dim"}>{loading ? "…" : c.n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* list */}
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="space-y-2.5">
            {[86, 100, 72, 92, 60].map((w, i) => (
              <div key={i} className="skeleton h-[74px] rounded-xl" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          inputsEmpty || !analysis ? (
            <div className="animate-fade-up mt-6 rounded-xl border border-line bg-ink/50 p-5 text-center">
              <svg viewBox="0 0 24 24" className="mx-auto h-9 w-9 text-dim" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4h7l4 4v12H7z" />
                <path d="M14 4v4h4" />
                <path d="M10 13h5M10 16h5" />
              </svg>
              <div className="mt-3 font-display text-sm font-bold text-mut">Пока нечего проверять</div>
              <p className="mx-auto mt-2 max-w-[280px] text-[12.5px] leading-relaxed text-dim">
                Вставьте содержимое eww.yuck и eww.scss в редакторы слева, импортируйте файлы или загрузите пример.
              </p>
            </div>
          ) : all.length === 0 ? (
            <div className="animate-fade-up mt-6 rounded-xl border border-mint/30 bg-mint/8 p-5 text-center">
              <svg viewBox="0 0 24 24" className="mx-auto h-9 w-9 text-mint" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M8.5 12.5l2.5 2.5 5-5.5" />
              </svg>
              <div className="mt-3 font-display text-sm font-bold text-mint">Конфиг в отличной форме</div>
              <p className="mx-auto mt-2 max-w-[280px] text-[12.5px] leading-relaxed text-mut">
                Ни одной находки: опросы разумные, слушатели событийные, стили без тяжёлых фильтров.
              </p>
            </div>
          ) : (
            <div className="mt-8 text-center text-[12.5px] text-dim">
              В этой категории пусто — переключите фильтр.
            </div>
          )
        ) : (
          <ul className="space-y-2.5">
            {visible.map((d, i) => {
              const meta = SEV_META[d.severity];
              return (
                <li
                  key={d.id}
                  className="animate-fade-up"
                  style={{ animationDelay: `${Math.min(i * 45, 400)}ms` }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onJump(d)}
                    onKeyDown={(e) => e.key === "Enter" && onJump(d)}
                    className={
                      "group cursor-pointer rounded-xl border border-line border-l-2 bg-panel/80 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-line2 hover:bg-raised " +
                      meta.ring
                    }
                  >
                    <div className="flex items-center gap-2">
                      <SevIcon sev={d.severity} />
                      <span className="rounded bg-ink/70 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-mut uppercase">
                        {d.tag}
                      </span>
                      <span className="ml-auto flex min-w-0 items-center gap-1 font-mono text-[10.5px] text-dim">
                        <span
                          title={d.file}
                          className={
                            "max-w-[140px] truncate rounded px-1.5 py-0.5 font-semibold " +
                            (d.file.endsWith(".scss") ? "bg-viol/12 text-viol" : "bg-amber/12 text-amber")
                          }
                        >
                          {d.file}
                        </span>
                        <span className="rounded bg-ink/70 px-1.5 py-0.5 transition-colors group-hover:text-fg">
                          стр. {d.line} ↵
                        </span>
                      </span>
                    </div>

                    <div className="mt-1.5 text-[13px] leading-snug font-bold text-fg">{d.title}</div>
                    <p className="mt-1 text-[12px] leading-relaxed text-mut">{d.detail}</p>

                    {d.fix && (
                      <div className="relative mt-2 rounded-lg border border-line/70 bg-ink/70 p-2.5 pr-3">
                        <CopyFix text={d.fix} onCopy={onCopy} />
                        <pre className="scroll-slim overflow-x-auto font-mono text-[11px] leading-[16px] whitespace-pre text-mint/90">
                          {d.fix}
                        </pre>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* footer */}
      <div className="border-t border-line px-4 py-2.5 text-[10.5px] text-dim">
        Клик по находке ведёт к строке кода · 33 правила анализа yuck, scss и include-графов
      </div>
    </div>
  );
}
