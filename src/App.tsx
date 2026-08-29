import { useCallback, useEffect, useRef, useState } from "react";
import CodeEditor, { type EditorApi } from "./components/CodeEditor";
import HelpModal from "./components/HelpModal";
import ScoreDial from "./components/ScoreDial";
import Diagnostics, { type Filter } from "./components/Diagnostics";
import { analyze, type Analysis, type Diagnostic, type FileKind, type MountedFile } from "./lib/analyzer";
import { SAMPLE_SCSS, SAMPLE_VOLUMES, SAMPLE_YUCK } from "./lib/sample";

const LS_YUCK = "ewwlint.v1.yuck";
const LS_SCSS = "ewwlint.v1.scss";
const LS_MOUNTED = "ewwlint.v1.mounted";
const LS_TAB = "ewwlint.v1.tab";

const DEFAULT_MOUNTED: MountedFile[] = [
  { id: "sample-volumes", path: "src/_volumes.yuck", content: SAMPLE_VOLUMES },
];

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

const loadJSON = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const parsed = JSON.parse(v);
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? (parsed as T) : fallback) : (parsed as T);
  } catch {
    return fallback;
  }
};

const saveJSON = (key: string, val: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* приватный режим — молча пропускаем */
  }
};

const newId = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const normPath = (p: string) => p.replace(/^\.\//, "").trim();

interface Toast {
  id: number;
  msg: string;
}

export default function App() {
  const [yuck, setYuck] = useState(() => load(LS_YUCK, SAMPLE_YUCK));
  const [scss, setScss] = useState(() => load(LS_SCSS, SAMPLE_SCSS));
  const [mounted, setMounted] = useState<MountedFile[]>(() => loadJSON(LS_MOUNTED, DEFAULT_MOUNTED));
  const [tab, setTab] = useState<string>(() => load(LS_TAB, "yuck"));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState<Toast | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastePath, setPastePath] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [pasteError, setPasteError] = useState("");

  const yuckApi = useRef<EditorApi | null>(null);
  const scssApi = useRef<EditorApi | null>(null);
  const mountedApis = useRef(new Map<string, EditorApi>());
  const fileInput = useRef<HTMLInputElement>(null);
  const yuckFileInput = useRef<HTMLInputElement>(null);
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
    (y: string, s: string, m: MountedFile[], withSkeleton: boolean) => {
      if (withSkeleton) setLoading(true);
      window.setTimeout(
        () => {
          setAnalysis(analyze(y, s, m));
          if (withSkeleton) setLoading(false);
        },
        withSkeleton ? 450 : 120
      );
    },
    []
  );

  /* первый запуск */
  useEffect(() => {
    const t = window.setTimeout(() => runAnalysis(yuck, scss, mounted, true), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* если сохранённая вкладка исчезла — возвращаемся к корню */
  useEffect(() => {
    if (tab.startsWith("m:") && !mounted.some((m) => `m:${m.id}` === tab)) setTab("yuck");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* автопроверка при правке (debounce) */
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = window.setTimeout(() => runAnalysis(yuck, scss, mounted, false), 900);
    return () => clearTimeout(t);
  }, [yuck, scss, mounted, runAnalysis]);

  /* автосохранение */
  useEffect(() => {
    save(LS_YUCK, yuck);
    save(LS_SCSS, scss);
    saveJSON(LS_MOUNTED, mounted);
    save(LS_TAB, tab);
    setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }, [yuck, scss, mounted, tab]);

  /* Ctrl+Enter — проверить */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runAnalysis(yuck, scss, mounted, true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [yuck, scss, mounted, runAnalysis]);

  const onJump = useCallback(
    (d: Diagnostic) => {
      const mf = mounted.find((m) => normPath(m.path) === d.file || m.path === d.file);
      if (d.file === "eww.yuck") setTab("yuck");
      else if (d.file === "eww.scss") setTab("scss");
      else if (mf) setTab(`m:${mf.id}`);
      else return;
      window.setTimeout(() => {
        const api =
          d.file === "eww.yuck"
            ? yuckApi.current
            : d.file === "eww.scss"
              ? scssApi.current
              : mf
                ? mountedApis.current.get(mf.id) ?? null
                : null;
        api?.jumpToLine(d.line);
      }, 70);
    },
    [mounted]
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
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;
    let scssText: string | null = null;
    const added: MountedFile[] = [];
    let pending = list.length;
    const finish = () => {
      if (--pending > 0) return;
      const nextMounted = [...mounted.filter((m) => !added.some((a) => normPath(a.path) === normPath(m.path))), ...added];
      const nextScss = scssText ?? scss;
      if (scssText !== null) {
        setScss(scssText);
        setTab("scss");
      }
      if (added.length) {
        setMounted(nextMounted);
        setTab(`m:${added[added.length - 1].id}`);
      }
      showToast(added.length ? `Подключено файлов: ${added.length}` : "Импортирован eww.scss");
      runAnalysis(yuck, nextScss, nextMounted, true);
    };
    list.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        if (/\.scss$/i.test(f.name)) scssText = text;
        else added.push({ id: newId(), path: f.name, content: text });
        finish();
      };
      reader.onerror = () => finish();
      reader.readAsText(f);
    });
  };

  const addPastedFile = () => {
    const p = pastePath.trim();
    if (!p) {
      setPasteError("Укажите путь — как в (include \"…\")");
      return;
    }
    if (!pasteContent.trim()) {
      setPasteError("Содержимое файла пустое");
      return;
    }
    const nf: MountedFile = { id: newId(), path: p, content: pasteContent };
    const next = [...mounted.filter((m) => normPath(m.path) !== normPath(p)), nf];
    setMounted(next);
    setTab(`m:${nf.id}`);
    setPasteOpen(false);
    setPastePath("");
    setPasteContent("");
    setPasteError("");
    showToast(`Подключён ${p}`);
    runAnalysis(yuck, scss, next, true);
  };

  const removeMounted = (id: string) => {
    const target = mounted.find((m) => m.id === id);
    setMounted((prev) => prev.filter((m) => m.id !== id));
    if (tab === `m:${id}`) setTab("yuck");
    if (target) showToast(`Отключён ${target.path}`);
  };

  const issueCount = (fileLabel: string, sev?: "error") =>
    (analysis?.diagnostics ?? []).filter((d) => d.file === fileLabel && (!sev || d.severity === sev)).length;

  const tabBadge = (fileLabel: string) => {
    const err = issueCount(fileLabel, "error");
    const all = issueCount(fileLabel);
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

  const activeMounted = tab.startsWith("m:") ? mounted.find((m) => `m:${m.id}` === tab) ?? null : null;
  const activeValue = tab === "yuck" ? yuck : tab === "scss" ? scss : activeMounted?.content ?? "";
  const activeLabel = tab === "yuck" ? "eww.yuck" : tab === "scss" ? "eww.scss" : activeMounted?.path ?? "—";
  const activeLines = activeValue.split("\n").length;
  const inputsEmpty = yuck.trim() === "" && scss.trim() === "" && mounted.every((m) => m.content.trim() === "");

  const onActiveChange = (v: string) => {
    if (tab === "yuck") setYuck(v);
    else if (tab === "scss") setScss(v);
    else if (activeMounted)
      setMounted((prev) => prev.map((m) => (m.id === activeMounted.id ? { ...m, content: v } : m)));
  };

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

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setHelpOpen(true)}
              title="Как пользоваться"
              aria-label="Как пользоваться"
              className="group flex h-9 w-9 items-center justify-center rounded-lg border border-line text-dim transition-all duration-200 hover:border-amber/60 hover:text-amber active:scale-90"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9.2" />
                <path d="M9.4 9.3a2.7 2.7 0 1 1 3.9 2.6c-.8.4-1.3 1-1.3 1.9v.4" />
                <circle cx="12" cy="17.2" r="0.4" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <div className="hidden md:block">
              <ScoreDial score={loading ? null : analysis?.score ?? null} grade={analysis?.grade ?? ""} />
            </div>
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
                  {tabBadge(f === "yuck" ? "eww.yuck" : "eww.scss")}
                </button>
              ))}
            </div>

            {/* вложенные файлы (include) */}
            <div className="flex w-full flex-wrap items-center gap-1.5 xl:w-auto xl:flex-1 xl:basis-full">
              <span className="mr-0.5 text-[9.5px] font-bold tracking-[0.14em] text-dim uppercase">include</span>
              {mounted.map((m) => {
                const label = normPath(m.path);
                const isActive = tab === `m:${m.id}`;
                const used = analysis?.filesUsed.includes(label) || analysis?.filesUsed.includes(m.path);
                return (
                  <div
                    key={m.id}
                    className={
                      "group/chip flex items-center gap-1 rounded-full border py-1 pr-1 pl-2.5 font-mono text-[11px] transition-all duration-200 " +
                      (isActive
                        ? "border-amber/60 bg-amber/12 text-amber"
                        : "border-line bg-panel text-mut hover:border-line2 hover:text-fg")
                    }
                  >
                    <button
                      onClick={() => setTab(`m:${m.id}`)}
                      className="flex max-w-[190px] items-center gap-1.5"
                      title={used ? `${m.path} — есть include на этот файл` : `${m.path} — ни один include не ссылается`}
                    >
                      <span
                        className={"h-1.5 w-1.5 shrink-0 rounded-full " + (used ? "bg-mint" : "bg-dim")}
                      />
                      <span className="truncate">{m.path}</span>
                    </button>
                    {tabBadge(label)}
                    <button
                      onClick={() => removeMounted(m.id)}
                      aria-label={`Отключить ${m.path}`}
                      title="Отключить файл"
                      className="rounded-full p-0.5 text-dim transition-all duration-150 hover:bg-coral/15 hover:text-coral active:scale-90"
                    >
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
              <input ref={yuckFileInput} type="file" accept=".yuck" multiple className="hidden" onChange={onImport} />
              <button
                onClick={() => yuckFileInput.current?.click()}
                title="Импортировать .yuck-файлы из ~/.config/eww"
                className="flex items-center gap-1 rounded-full border border-dashed border-line2 px-2.5 py-1 font-mono text-[11px] font-semibold text-dim transition-all duration-200 hover:border-amber/50 hover:text-amber active:scale-95"
              >
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                файл
              </button>
              <button
                onClick={() => {
                  setPasteOpen(true);
                  setPasteError("");
                }}
                title="Вставить содержимое вложенного файла вручную"
                className="flex items-center gap-1 rounded-full border border-dashed border-line2 px-2.5 py-1 font-mono text-[11px] font-semibold text-dim transition-all duration-200 hover:border-amber/50 hover:text-amber active:scale-95"
              >
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="8" y="3" width="8" height="4" rx="1" />
                  <path d="M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
                </svg>
                вставить
              </button>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input ref={fileInput} type="file" accept=".yuck,.scss,.txt" multiple className="hidden" onChange={onImport} />
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
                  setMounted(DEFAULT_MOUNTED);
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
                  setMounted([]);
                  setTab("yuck");
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
                onClick={() => runAnalysis(yuck, scss, mounted, true)}
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
              onChange={onActiveChange}
              lang={tab === "scss" ? "scss" : "yuck"}
              placeholder={
                tab === "scss"
                  ? "/* вставьте сюда содержимое eww.scss… */"
                  : "; вставьте сюда содержимое yuck-файла…"
              }
              registerApi={
                tab === "yuck"
                  ? registerYuck
                  : tab === "scss"
                    ? registerScss
                    : (api) => {
                        if (activeMounted) mountedApis.current.set(activeMounted.id, api);
                      }
              }
            />
            {/* status bar */}
            <div className="flex items-center gap-4 border-t border-line bg-panel px-4 py-2 font-mono text-[10.5px] text-dim">
              <span className="max-w-[220px] truncate font-semibold text-mut" title={activeLabel}>
                {activeLabel}
              </span>
              <span>{activeLines} строк</span>
              <span>{activeValue.length} симв.</span>
              {tab !== "scss" && analysis && !loading && (
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

      {/* paste nested file */}
      {pasteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/70 backdrop-blur-[2px]" onClick={() => setPasteOpen(false)} />
          <div className="animate-fade-up relative w-full max-w-lg rounded-xl border border-line bg-panel p-5 shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[13px] font-bold text-fg">Вложенный файл</h3>
              <button
                onClick={() => setPasteOpen(false)}
                aria-label="Закрыть"
                className="rounded p-1 text-dim transition-colors hover:text-fg"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
              Путь относительно <span className="font-mono text-mut">~/.config/eww</span> — ровно как в{" "}
              <span className="font-mono text-mut">(include "…")</span>. Анализатор проверит файл и сопоставит его с include.
            </p>
            <input
              autoFocus
              value={pastePath}
              onChange={(e) => setPastePath(e.target.value)}
              placeholder="src/_sidebar.yuck"
              className="mt-3 w-full rounded-lg border border-line bg-ink px-3 py-2 font-mono text-[12px] text-fg outline-none transition-colors focus:border-amber/60"
            />
            <textarea
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              rows={9}
              placeholder="; содержимое файла…"
              className="scroll-slim mt-2 w-full resize-none rounded-lg border border-line bg-ink px-3 py-2 font-mono text-[12px] leading-[18px] whitespace-pre text-fg outline-none transition-colors focus:border-amber/60"
            />
            {pasteError && <p className="mt-1.5 text-[11px] font-bold text-coral">{pasteError}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setPasteOpen(false)}
                className="rounded-lg border border-line px-3.5 py-2 text-[12px] font-semibold text-mut transition-all duration-200 hover:border-line2 hover:text-fg active:scale-95"
              >
                Отмена
              </button>
              <button
                onClick={addPastedFile}
                className="rounded-lg bg-amber px-4 py-2 text-[12px] font-extrabold text-ink shadow-[0_4px_18px_rgba(242,176,78,0.25)] transition-all duration-200 hover:bg-amber2 active:scale-95"
              >
                Подключить файл
              </button>
            </div>
          </div>
        </div>
      )}

      {/* help */}
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onTrySample={() => {
          setYuck(SAMPLE_YUCK);
          setScss(SAMPLE_SCSS);
          setTab("yuck");
          showToast("Загружен пример конфига");
        }}
      />

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
