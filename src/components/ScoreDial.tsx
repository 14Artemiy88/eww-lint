import { useEffect, useRef, useState } from "react";

interface Props {
  score: number | null;
  grade: string;
}

const colorFor = (s: number) => (s >= 75 ? "#55d6a0" : s >= 45 ? "#f2b04e" : "#ff7b72");

export default function ScoreDial({ score, grade }: Props) {
  const [shown, setShown] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const target = score ?? 0;
    const from = shown;
    const start = performance.now();
    const dur = 750;
    cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  const R = 30;
  const C = 2 * Math.PI * R;
  const val = score ?? 0;
  const color = score === null ? "#31455e" : colorFor(val);

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[76px] w-[76px]">
        <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
          <circle cx="38" cy="38" r={R} fill="none" stroke="#223146" strokeWidth="7" />
          <circle
            cx="38"
            cy="38"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C - (C * shown) / 100}
            style={{
              transition: "stroke 600ms ease",
              filter: score === null ? "none" : `drop-shadow(0 0 6px ${color}66)`,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-display text-lg font-bold tabular-nums"
            style={{ color: score === null ? "#5c7189" : color }}
          >
            {score === null ? "–" : shown}
          </span>
        </div>
      </div>
      <div className="leading-tight">
        <div className="text-[11px] font-semibold tracking-[0.14em] text-dim uppercase">
          Индекс оптимизации
        </div>
        <div className="mt-0.5 text-sm font-bold" style={{ color: score === null ? "#5c7189" : color }}>
          {score === null ? "ожидание" : grade}
        </div>
      </div>
    </div>
  );
}
