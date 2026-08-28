import { useCallback, useEffect, useRef, useState } from "react";
import CodeEditor, { type EditorApi } from "./components/CodeEditor";
import ScoreDial from "./components/ScoreDial";
import Diagnostics, { type Filter } from "./components/Diagnostics";
import { analyze, type Analysis, type Diagnostic, type FileKind } from "./lib/analyzer";
import { SAMPLE_SCSS, SAMPLE_YUCK } from "./lib/sample";

const LS_YUCK = "ewwlint.v1.yuck";
const LS_SCSS = "ewwlint.v1.scss";

const load = (key: string, fallback: string) => {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch {
    return fallback;
  }
};

const save = (key: string, val: string) => {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* приватный режим — молча пропускаем */
  }
};

interface Toast {
  id: number;
  msg: string;
}

export default function App() {
  const [yuck, setYuck] = useState(() => load(LS_YUCK, SAMPLE_YUCK));
  const [scss, setScss] = useState(() => load(LS_SCSS, SAMPLE_SCSS));
  const [tab, setTab] = useState<FileKind>("yuck");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState<Toast | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const yuckApi = useRef<EditorApi | null>(null);
  const scssApi = useRef<EditorApi | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const firstRun = useRef(true);
  const toastTimer = useRef(0);

  const registerYuck = useCallback((api: EditorApi) => (yuckApi.current = api), []);
  const registerScss = useCallback((api: EditorApi) => (scssApi.current = api), []);

  const showToast = useCallback((msg: string) => {
    setToast({ id: Date.now(), msg });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2300);
  }, []);

  const runAnalysis = useCallback(
    (y: string, s: string, withSkeleton: boolean) => {
      if (withSkeleton) setLoading(true);
      window.setTimeout(
        () => {
          setAnalysis(analyze(y, s));
          if (withSkeleton) setLoading(false);
        },
        withSkeleton ? 450 : 120
      );
    },
    []
  );

  /* первый запуск */
  useEffect(() => {
    const t = window.setTimeout(() => runAnalysis(yuck, scss, true), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* автопроверка при правке (debounce) */
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = window.setTimeout(() => runAnalysis(yuck, scss, false), 900);
    return () => clearTimeout(t);
  }, [yuck, scss, runAnalysis]);

  /* автосохранение */
  useEffect(() => {
    save(LS_YUCK, yuck);
    save(LS_SCSS, scss);
    setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }, [yuck, scss]);

  /* Ctrl+Enter — проверить */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runAnalysis(yuck, scss, true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [yuck, scss, runAnalysis]);

  const onJump = useCallback(
    (d: Diagnostic) => {
      setTab(d.file);
      window.setTimeout(() => {
        const api = d.file === "yuck" ? yuckApi.current : scssApi.current;
        api?.jumpToLine(d.line);
      }, 70);
    },
    []
  );

  const onCopy = useCallback(
    (text: string, label: string) => {
      const done = () => showToast(label);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      }
    },
    [showToast]
  );

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const isScss = /\.scss$/i.test(f.name) || /^\s*(\*|\.|#|\$|@)/.test(text.slice(0, 200));
      if (isScss) {
        setScss(text);
        setTab("scss");
      } else {
        setYuck(text);
        setTab("yuck");
      }
      showToast(`Импортирован ${f.name}`);
      runAnalysis(isScss ? yuck : text, isScss ? text : scss, true);
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  const issueCount = (file: FileKind, sev?: "error") =>
    (analysis?.diagnostics ?? []).filter((d) => d.file === file && (!sev || d.severity === sev)).length;

  const tabBadge = (file: FileKind) => {
    const err = issueCount(file, "error");
    const all = issueCount(file);
    if (!analysis || loading) return null;
    const color = err > 0 ? "#ff7b72" : all > 0 ? "#f2b04e" : "#55d6a0";
    return (
      <span
        className="rounded-full px-1.5 py-px font-mono text-[10px] font-bold tabular-nums"
        style={{ background: color + "22", color }}
      >
        {all}
      </span>
    );
  };

  const activeValue = tab === "yuck" ? yuck : scss;
  const activeLines = activeValue.split("\n").length;
  const inputsEmpty = yuck.trim() === "" && scss.trim() === "";

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden xl:h-screen">
      {/* ambient background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="bg-stage absolute inset-0" />
        <div
          className="animate-drift-a absolute -top-40 -right-32 h-[520px] w-[520px] rounded-full opacity-[0.13]"
          style={{ background: "radial-gradient(circle, #55d6a0 0%, transparent 62%)", filter: "blur(60px)" }}
        />
        <div
          className="animate-drift-b absolute -bottom-48 -left-32 h-[560px] w-[560px] rounded-full opacity-[0.11]"
          style={{ background: "radial-gradient(circle, #f2b04e 0%, transparent 62%)", filter: "blur(60px)" }}
        />
        <div
          className="absolute top-1/3 left-1/2 h-[380px] w-[620px] -translate-x-1/2 rounded-full opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #6fb7ff 0%, transparent 65%)", filter: "blur(70px)" }}
        />
      </div>

      {/* header */}
      <header className="relative z-10 border-b border-line bg-ink/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1560px] items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 32 32" className="h-9 w-9">
              <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="#182231" stroke="#f2b04e" strokeWidth="1.6" />
              <path d="M11.5 9.5c-3.2 2.2-3.2 10.8 0 13" fill="none" stroke="#e7eef7" strokeWidth="1.9" strokeLinecap="round" />
              <path d="M20.5 9.5c3.2 2.2 3.2 10.8 0 13" fill="none" stroke="#e7eef7" strokeWidth="1.9" strokeLinecap="round" />
              <circle cx="16" cy="16" r="2.1" fill="#55d6a0" />
            </svg>
            <div className="leading-tight">
              <div className="font-display text-[17px] font-black tracking-tight text-fg">
                eww<span className="text-amber">·</span>lint
              </div>
              <div className="text-[10.5px] font-medium tracking-wide text-dim">
                анализ и оптимизация конфигов ElKowars Wacky Widgets
              </div>
            </div>
          </div>

          <div className="ml-auto hidden md:block">
            <ScoreDial score={loading ? null : analysis?.score ?? null} grade={analysis?.grade ?? ""} />
          </div>
        </div>
        <div className="h-px w-full bg-gradient-to-r from-transparent via-amber/50 to-transparent" />
      </header>

      {/* main */}
      <main className="relative z-10 mx-auto grid w-full max-w-[1560px] flex-1 min-h-0 grid-cols-1 gap-4 px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_408px]">
        {/* left: editor */}
        <section className="flex min-h-0 flex-col">
          {/* toolbar */}
          <div className="animate-fade-up mb-3 flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-line bg-panel">
              {(["yuck", "scss"] as FileKind[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setTab(f)}
                  className={
                    "flex items-center gap-2 px-3.5 py-2 font-mono text-[12px] font-semibold transition-colors duration-200 " +
                    (tab === f ? "bg-raised text-fg shadow-inner" : "text-dim hover:text-mut")
                  }
                >
                  <span className={f === "yuck" ? "text-amber" : "text-viol"}>{f === "yuck" ? "( )" : "{ }"}</span>
                  {f === "yuck" ? "eww.yuck" : "eww.scss"}
                  {tabBadge(f)}
                </button>
              ))}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input ref={fileInput} type="file" accept=".yuck,.scss,.txt" className="hidden" onChange={onImport} />
              <button
                onClick={() => fileInput.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] font-semibold text-mut transition-all duration-200 hover:border-line2 hover:text-fg active:scale-95"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
                  <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
                Импорт
              </button>
              <button
                onClick={() => {
                  setYuck(SAMPLE_YUCK);
                  setScss(SAMPLE_SCSS);
                  setTab("yuck");
                  showToast("Загружен пример конфига");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] font-semibold text-mut transition-all duration-200 hover:border-line2 hover:text-fg active:scale-95"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3h6v3l2 4-5 3-5-3 2-4V3z" />
                  <path d="M7 13l-3 7h16l-3-7" />
                </svg>
                Пример
              </button>
              <button
                onClick={() => {
                  setYuck("");
                  setScss("");
                  showToast("Редакторы очищены");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] font-semibold text-mut transition-all duration-200 hover:border-coral/50 hover:text-coral active:scale-95"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7" />
                </svg>
                Очистить
              </button>
              <button
                onClick={() => runAnalysis(yuck, scss, true)}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-amber px-4 py-2 text-[12px] font-extrabold text-ink shadow-[0_4px_18px_rgba(242,176,78,0.25)] transition-all duration-200 hover:bg-amber2 active:scale-95 disabled:opacity-60"
              >
                {loading ? (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M12 3a9 9 0 1 1-6.4 2.6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="m20 20-4.4-4.4" />
                  </svg>
                )}
                {loading ? "Анализ…" : "Проверить"}
                <span className="hidden rounded bg-ink/15 px-1 font-mono text-[10px] font-bold lg:inline">⌘⏎</span>
              </button>
            </div>
          </div>

          {/* editor panel */}
          <div
            className="animate-fade-up flex h-[460px] min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_10px_40px_rgba(0,0,0,0.35)] sm:h-[520px] xl:h-auto"
            style={{ animationDelay: "80ms" }}
          >
            <CodeEditor
              value={activeValue}
              onChange={tab === "yuck" ? setYuck : setScss}
              lang={tab}
              placeholder={tab === "yuck" ? "; вставьте сюда содержимое eww.yuck…" : "/* вставьте сюда содержимое eww.scss… */"}
              registerApi={tab === "yuck" ? registerYuck : registerScss}
            />
            {/* status bar */}
            <div className="flex items-center gap-4 border-t border-line bg-panel px-4 py-2 font-mono text-[10.5px] text-dim">
              <span className="font-semibold text-mut">{tab === "yuck" ? "yuck" : "scss"}</span>
              <span>{activeLines} строк</span>
              <span>{activeValue.length} симв.</span>
              {tab === "yuck" && analysis && !loading && (
                <span>
                  defpoll: <span className="text-amber">{analysis.stats.polls}</span> · deflisten:{" "}
                  <span className="text-mint">{analysis.stats.listens}</span>
                </span>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                <span className="animate-blink-dot h-1.5 w-1.5 rounded-full bg-mint" />
                автосохранение{savedAt ? ` · ${savedAt}` : ""}
              </span>
            </div>
          </div>

          {/* mobile score */}
          <div className="mt-3 flex justify-center md:hidden">
            <ScoreDial score={loading ? null : analysis?.score ?? null} grade={analysis?.grade ?? ""} />
          </div>
        </section>

        {/* right: diagnostics */}
        <aside
          className="animate-fade-up flex h-[560px] min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_10px_40px_rgba(0,0,0,0.35)] xl:h-auto"
          style={{ animationDelay: "160ms" }}
        >
          <Diagnostics
            analysis={analysis}
            loading={loading}
            filter={filter}
            onFilter={setFilter}
            onJump={onJump}
            onCopy={onCopy}
            inputsEmpty={inputsEmpty}
          />
        </aside>
      </main>

      {/* toast */}
      {toast && (
        <div
          key={toast.id}
          className="animate-toast-in fixed right-5 bottom-5 z-50 flex items-center gap-2.5 rounded-xl border border-mint/40 bg-raised px-4 py-3 text-[12.5px] font-bold text-fg shadow-[0_12px_36px_rgba(0,0,0,0.5)]"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-mint" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
