import { useEffect, useMemo, useRef, useState } from "react";

export interface EditorApi {
  jumpToLine: (line: number) => void;
}

interface Token {
  t: string;
  cls: string | null;
}

const YUCK_SRC =
  "(;[^\\n]*)|(`(?:[^`\\\\]|\\\\.)*`|\"(?:[^\"\\\\]|\\\\.)*\")|(\\(\\s*(?:defpoll|deflisten|defvar|defwidget|defwindow))|(:[A-Za-z][\\w-]*)|([()])|(\\$[\\w-]+)";
const YUCK_CLS = ["tk-comment", "tk-string", "tk-keyword", "tk-prop", "tk-punct", "tk-var"];

const SCSS_SRC =
  "(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')|(#[0-9a-fA-F]{3,8}\\b)|(rgba?\\([^)]*\\))|(@[\\w-]+)|(\\$[\\w-]+)|(&[\\w-]+|::?[\\w-]+(?=[\\s({,:]))|([{};,])";
const SCSS_CLS = [
  "tk-comment",
  "tk-string",
  "tk-hex",
  "tk-fn",
  "tk-at",
  "tk-var",
  "tk-pseudo",
  "tk-punct",
];

const tokenize = (src: string, lang: "yuck" | "scss"): Token[] => {
  const re = new RegExp(lang === "yuck" ? YUCK_SRC : SCSS_SRC, "g");
  const cls = lang === "yuck" ? YUCK_CLS : SCSS_CLS;
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: src.slice(last, m.index), cls: null });
    let group = 0;
    for (let g = 1; g < m.length; g++) {
      if (m[g] !== undefined) {
        group = g - 1;
        break;
      }
    }
    out.push({ t: m[0], cls: cls[group] ?? null });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < src.length) out.push({ t: src.slice(last), cls: null });
  return out;
};

const LINE_H = 20;

interface Props {
  value: string;
  onChange: (v: string) => void;
  lang: "yuck" | "scss";
  placeholder: string;
  registerApi: (api: EditorApi) => void;
}

export default function CodeEditor({ value, onChange, lang, placeholder, registerApi }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<number | null>(null);

  const tokens = useMemo(() => tokenize(value, lang), [value, lang]);
  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const gutterW = String(Math.max(lineCount, 10)).length * 9 + 22;

  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    registerApi({
      jumpToLine: (line: number) => {
        const ta = taRef.current;
        if (!ta) return;
        const lines = ta.value.split("\n");
        const idx = lines.slice(0, line - 1).reduce((s, l) => s + l.length + 1, 0);
        const end = idx + (lines[line - 1]?.length ?? 0);
        ta.focus();
        ta.setSelectionRange(idx, end);
        ta.scrollTop = Math.max(0, (line - 1) * LINE_H - 90);
        setFlash(line);
      },
    });
  }, [registerApi]);

  const onScroll = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    const gut = gutterRef.current;
    if (!ta) return;
    if (pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
    if (gut) gut.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart, selectionEnd } = ta;
      const next = ta.value.slice(0, selectionStart) + "  " + ta.value.slice(selectionEnd);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = selectionStart + 2;
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-ink/60">
      {/* gutter */}
      <div className="shrink-0 overflow-hidden border-r border-line/70 bg-panel/60 pt-3.5 text-right select-none">
        <div ref={gutterRef} style={{ width: gutterW }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              className={
                "pr-3 font-mono text-[11px] leading-[20px] transition-colors duration-300 " +
                (flash === i + 1
                  ? "bg-amber/25 font-bold text-amber"
                  : "text-dim")
              }
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* code area */}
      <div className="relative min-w-0 flex-1">
        <pre ref={preRef} aria-hidden className="editor-pre absolute inset-0 m-0 overflow-hidden px-4 py-3.5 text-[#c9d7e8]">
          {tokens.map((tok, i) =>
            tok.cls ? (
              <span key={i} className={tok.cls}>
                {tok.t}
              </span>
            ) : (
              tok.t
            )
          )}
          {"\n"}
        </pre>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className="editor-textarea scroll-slim absolute inset-0 h-full w-full overflow-auto px-4 py-3.5"
        />
      </div>
    </div>
  );
}
