// Julix's page (agent-docs/rebrand/apps/julix): one window, no rail. The bar (mark, folder, Run / Stop,
// the runtimes key, the Panels key, the theme); Files at the left; the script and its figure; the
// Workspace card at the right; the Console below. Settings, help and About are Ctrl K commands; Ctrl K
// is the only way to search. Everything shown comes from the app server; the files are the record.
import {
  About, AppMark, DebugDock, DEBUG_KEYS, Dialog, HelpWindow, Icon, Key, Menu, Notifications, Panel, PanelsKey, Search, Segmented, Spinner, Split, ThemePicker, Toasts, chordMatches, readStored, typing, useTheme, useToasts, writeStored,
  type Command, type Credit, type HelpProvider, type MenuEntry, type PaneRect, type SearchItem, type Theme,
} from "@paperboatlab/ui";
import { EditorSettingsKey, TabMenu, afterClose, orderTabs, tabMenu, useEditorSettings, type EditorPos } from "@paperboatlab/ui/editor";
import { FileTree, fileIconFor, type FileActions, type FileEntry } from "@paperboatlab/ui/files";
import { ConnectHub, HubSelector, type Hub } from "@paperboatlab/ui/hub";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, listen, session as juliaSession, type Breakpoint, type DebugCommand, type Entry, type Figure, type HubInfo, type Paused, type Run, type Variable } from "./api.ts";
import { cellAt, cells } from "./cells.ts";
import { Code } from "./Code.tsx";
import { Console } from "./Console.tsx";
import { RuntimesKey } from "./Keys.tsx";
import { Packages } from "./Packages.tsx";
import { Workspace, type FigureRef, type WorkspaceTab } from "./Workspace.tsx";
import { Debug } from "./Debug.tsx";
import { applyRun, type Result } from "./results.ts";
import { FIGURE, Figure as FigurePane } from "./figure/Figure.tsx";

type Side = "l" | "f" | "b" | "r";
const PANELS: { side: Side; name: string; keys: string }[] = [
  { side: "l", name: "Files", keys: "Ctrl B" }, { side: "f", name: "Figure", keys: "Ctrl Alt F" },
  { side: "b", name: "Console", keys: "Ctrl J" }, { side: "r", name: "Workspace", keys: "Ctrl Alt B" },
];
/** The window as the Panels key sketches it: files, editor, figure, console, workspace. */
const LAYOUT: Record<string, PaneRect> = { l: [4, 4, 10, 36], e: [16, 4, 16, 26], f: [34, 4, 12, 26], b: [16, 32, 30, 8], r: [48, 4, 12, 36] };
type Ask = { title: string; label?: string; value?: string; danger?: boolean; ok: string; text?: string; run: (v: string) => void };
type Doc = { path: string; text: string; readOnly: boolean; v: number };   // v: a new copy from disk (remounts the editor)
const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark" || v === "system";
const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isHidden = (v: unknown): v is Record<Side, boolean> => !!v && typeof v === "object" && PANELS.every((p) => typeof (v as any)[p.side] === "boolean");
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const files = (es: Entry[]): string[] => es.flatMap((e) => (e.kind === "dir" ? files(e.children ?? []) : [e.path]));
const typeOf = (p: string) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1).toLowerCase() : "");
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const FILES_W = 250, WORKSPACE_W = 300;   // the side cards' widths (hidden, the kit's 38 px slim bar)
/** The server's tree as the kit's FileTree takes it: one row per entry, its depth beside it. */
const rows = (es: Entry[], depth = 0): FileEntry[] =>
  es.flatMap((e) => [{ path: e.path, name: e.name, depth, kind: e.kind === "dir" ? "folder" : "file" } as FileEntry, ...(e.kind === "dir" ? rows(e.children ?? [], depth + 1) : [])]);
function TypeIcon({ name, folder = false }: { name: string; folder?: boolean }) {
  const { icon, tone } = fileIconFor(name, folder ? "folder" : "file");
  return <span className="fi" style={{ color: `var(--file-${tone})` }}><Icon name={icon} size={14} /></span>;
}
const kitHub = (h: HubInfo): Hub => ({ id: h.id, name: h.name, place: h.place, path: h.shown, missing: h.missing, conflicts: h.conflicts });
const NEW_SCRIPT = "# A Julia script. F5 runs it; Ctrl Enter runs the cell at the cursor (a cell starts at ##).\n\n## First cell\n";

/** Seconds since a run started, ticking on its own so the whole page doesn't redraw. */
function Elapsed({ since }: { since?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(t); }, []);
  const s = since ? Math.max(0, (Date.now() - Date.parse(since)) / 1000) : 0;
  return <span className="mono">{s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`}</span>;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() => readStored("paperboat.theme", isTheme) ?? "system");
  const appTheme = useTheme(theme);
  const [editor, setEditor] = useEditorSettings(undefined, "julix.editor");   // ponytail: in localStorage until Julix keeps a settings file
  const [folder, setFolder] = useState<{ name: string; root: string; version: string } | null>(null);
  // the hub Julix works in (by id, so a renamed or moved hub is found again), and the hubs Malachite knows:
  // read when the page opens, and again as the selector, Ctrl K, Settings or the connect dialog opens.
  // No Malachite, no hub: with none, nothing on the page mentions hubs.
  const [hubId, setHubId] = useState<string | null>(() => readStored("julix.hub", (v): v is string => typeof v === "string") ?? null);
  const [hubs, setHubs] = useState<HubInfo[]>([]);
  const readHubs = useCallback(() => api.hubs().then((l) => { setHubs(l); return l; }, () => [] as HubInfo[]), []);
  const [tree, setTree] = useState<{ files: Entry[]; examples: Entry[] }>({ files: [], examples: [] });
  const [tabs, setTabs] = useState<string[]>(() => readStored("julix.tabs", isList) ?? []);
  const [current, setCurrent] = useState<string | null>(() => readStored("julix.tabs", isList)?.[0] ?? null);
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(readStored("julix.pinned", isList) ?? []));
  const [bpAt, setBpAt] = useState<{ path: string; line: number; x: number; y: number } | null>(null);   // the breakpoint gutter's right-click menu
  const [tabAt, setTabAt] = useState<{ path: string; x: number; y: number } | null>(null);   // a tab's right-click menu
  const [doc, setDoc] = useState<Doc | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [hidden, setHidden] = useState<Record<Side, boolean>>(() => readStored("julix.panels", isHidden) ?? { l: false, f: false, b: false, r: false });
  const [runs, setRuns] = useState<Run[]>([]);
  const [session, setSession] = useState<"stopped" | "starting" | "running">("stopped");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [shown, setShown] = useState<FigureRef | null>(null);
  const [results, setResults] = useState<Record<string, Result[]>>({});   // per file: what its lines made when they last ran
  const [wtab, setWtab] = useState<WorkspaceTab>("vars");
  // the debugger: breakpoints per file (kept in the browser), and where a debug run waits
  const [bps, setBps] = useState<Record<string, Breakpoint[]>>(() => readStored("julix.breakpoints", (v): v is Record<string, Breakpoint[]> => !!v && typeof v === "object") ?? {});
  const [paused, setPaused] = useState<Paused | null>(null);
  useEffect(() => writeStored("julix.breakpoints", bps), [bps]);
  const [resetSeq, setResetSeq] = useState(0);
  // the figure pane's default: 45% of what Files and Workspace leave the editor and it (less the four 14 px
  // --gutter around and between), never so much the editor drops under its 320; the gutter to the editor sizes it
  const figWidth = () => {
    const both = innerWidth - 4 * 14 - (hidden.l ? 38 : FILES_W) - (hidden.r ? 38 : WORKSPACE_W) - 14;
    return Math.round(Math.max(320, Math.min(900, both * 0.45, both - 320)));
  };
  const [figW, setFigW] = useState(() => readStored("julix.figure", (v): v is number => typeof v === "number") ?? figWidth());
  useEffect(() => writeStored("julix.figure", figW), [figW]);
  const [peekVersion, setPeekVersion] = useState(0);
  const [search, setSearch] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dialog, setDialog] = useState<"settings" | "about" | "packages" | "help" | "hub" | null>(null);
  const notes = useToasts();
  const { toasts, show, dismiss } = notes;
  const fail = useCallback((e: unknown) => show({ title: "Couldn't do that", detail: String((e as Error).message ?? e), state: "failed" }), [show]);
  const currentRef = useRef(current);
  const copies = useRef(0);
  const starting = useRef<number | null>(null);   // the "Starting Julia" toast, till the session is up or gave up
  const unsaved = useRef(new Map<string, number>());   // a file that failed to save: its toast, till a save goes through
  currentRef.current = current;
  const switching = useRef(false);   // this page moves the server to another folder: it reloads itself

  useEffect(() => writeStored("paperboat.theme", theme), [theme]);
  useEffect(() => writeStored("julix.panels", hidden), [hidden]);
  useEffect(() => writeStored("julix.pinned", [...pinned]), [pinned]);
  useEffect(() => writeStored("julix.tabs", current ? [current, ...tabs.filter((t) => t !== current)] : tabs), [tabs, current]);
  const toggle = useCallback((s: Side, h?: boolean) => setHidden((x) => ({ ...x, [s]: h ?? !x[s] })), []);

  const open = useCallback((p: string, side = false) => {
    setTabs((t) => (t.includes(p) ? t : side ? [...t, p] : [p, ...t].slice(0, 12)));
    if (!side) setCurrent(p);
  }, []);
  // a debug run waits (or goes on): the Debug tab shows, and the file it waits in
  const stopped = useCallback((p: Paused | null) => {
    setPaused(p);
    if (p) { setWtab("debug"); setHidden((h) => (h.r ? { ...h, r: false } : h)); if (p.source !== currentRef.current) open(p.source); }
  }, [open]);
  const reload = useCallback(() => api.tree().then(setTree, fail), [fail]);
  const reloadFigures = useCallback(() => api.figures().then((fs) => { setFigures(fs); setShown((s) => s ?? (fs[0] ? { run: fs[0].run, n: fs[0].n } : null)); }, () => {}), []);
  useEffect(() => {
    api.folder().then(async (v) => {
      // back in the hub this page last worked in (the server starts on the folder it was opened on)
      const want = readStored("julix.hub", (x): x is string => typeof x === "string");
      const list = want || v.hub ? await readHubs() : (readHubs(), []);   // a plain folder doesn't wait for Malachite
      if (want && v.hub !== want) {
        const h = list.find((x) => x.id === want);
        if (h && !h.missing && await api.connect(want).then(() => true, (e) => { fail(e); return false; })) { switching.current = true; location.reload(); return; }
        setTabs([]); setCurrent(null);   // the hub's tabs aren't in this folder
        if (!h) setHubId(null);   // no Malachite, or the hub is off the list: a plain folder again
      } else if (!want && v.hub && list.length) setHubId(v.hub);   // another page connected this server
      setFolder(v); setSession(v.session); document.title = `${v.name} · Julix`;
    }, fail);
    reload(); reloadFigures();
    api.variables().then(setVariables, () => {});
    api.runs().then((rs) => { setRuns(rs); setResults(rs.reduce(applyRun, {})); }, () => {});
    api.paused().then((r) => stopped(r.paused), () => {});
  }, [reload, reloadFigures, readHubs, fail, stopped]);
  useEffect(() => writeStored("julix.hub", hubId), [hubId]);

  const load = useCallback((p: string | null) => {
    if (!p) { setDoc(null); return; }
    api.file(p).then((d) => { if (currentRef.current === p) { setDoc({ ...d, v: ++copies.current }); setDraft(null); } }, (e) => { setDoc(null); fail(e); });
  }, [fail]);
  useEffect(() => { if (folder) load(current); }, [folder, current, load]);

  // live: files (anyone's changes), runs, the variables, the session
  useEffect(() => listen((e) => {
    if (e.type === "files") {
      reload();
      const c = currentRef.current;
      if (c && (e.changed as string[]).includes(c)) setDraft((d) => { if (d === null) load(c); return d; });
    } else if (e.type === "run") {
      const r = e.run as Run;
      setRuns((rs) => { const i = rs.findIndex((x) => x.id === r.id); return i < 0 ? [...rs, r].slice(-300) : rs.map((x, j) => (j === i ? r : x)); });
      if (r.state === "done" || r.state === "failed") {
        setPeekVersion((v) => v + 1);
        const figs = r.outputs.filter((o) => o.type === "figure");
        setResults((m) => applyRun(m, r));
        if (figs.length) { reloadFigures(); setShown({ run: r.id, n: (figs.at(-1) as { n: number }).n }); setHidden((h) => (h.f ? { ...h, f: false } : h)); }
      }
    } else if (e.type === "variables") setVariables(e.variables);
    else if (e.type === "figures") reloadFigures();
    else if (e.type === "debug") stopped(e.paused as Paused | null);
    else if (e.type === "folder" && !switching.current) location.reload();   // another page connected the server elsewhere
    else if (e.type === "session") {
      setSession(e.state); setPeekVersion((v) => v + 1);
      // the session starts in the background (the first time in a folder it adds JulixPlot too): one toast, working to its end
      if (e.state === "starting") starting.current ??= show({ title: "Starting Julia", detail: "runs wait for it", state: "working" });
      else if (starting.current !== null) {
        show({ id: starting.current, ...(e.state === "running" ? { title: "Julia is ready", state: "done" } : { title: "Julia didn't start", detail: "the Console has the error", state: "failed" }) });
        starting.current = null;
      }
    }
  }), [reload, reloadFigures, load, show]);

  const running = runs.some((r) => r.state === "running" || r.state === "queued");
  const now = runs.find((r) => r.state === "running");   // the run the session is on; queued ones wait behind it
  const busy = now && now.kind !== "console" ? { path: now.source, from: now.line, to: now.line + now.code.split("\n").length - 1 } : undefined;

  // a deep link opens a file: /?open=<path in the folder> (the Launcher and other apps use it)
  useEffect(() => { const p = new URLSearchParams(location.search).get("open"); if (p) open(p); }, [open]);
  const save = useCallback(async (p: string, text: string) => {
    const id = unsaved.current.get(p);
    try {
      await api.save(p, text); setDraft((d) => (d === text ? null : d)); setDoc((d) => (d && d.path === p ? { ...d, text } : d));
      if (id !== undefined) { unsaved.current.delete(p); show({ id, title: `${base(p)} saved`, state: "done" }); }
    } catch (e) {
      // autosave retries on the next pause; one toast per file, not one per try
      unsaved.current.set(p, show({ id, title: `Couldn't save ${base(p)}`, detail: `${(e as Error).message ?? e} · the text stays in the editor`, state: "failed" }));
    }
  }, [show]);
  // a close never loses work: only the shown tab can be unsaved, and it is saved before it goes
  const closeTabs = (paths: string[]) => {
    if (current && paths.includes(current) && draft !== null && !doc?.readOnly) save(current, draft);
    const next = afterClose(tabs, current, paths);
    setTabs(next.tabs); setCurrent(next.current);
    setPinned((s) => (paths.some((p) => s.has(p)) ? new Set([...s].filter((p) => !paths.includes(p))) : s));
  };
  const close = (p: string) => closeTabs([p]);
  // connect, switch or disconnect: the typing is saved first, the tabs (this folder's) close, the page reloads
  const workIn = async (go: () => Promise<{ hub: string | null }>) => {
    try {
      if (current && draft !== null && !doc?.readOnly) await api.save(current, draft);
      switching.current = true;
      const r = await go();
      writeStored("julix.hub", r.hub); writeStored("julix.tabs", []); writeStored("julix.pinned", []);
      location.reload();
    } catch (e) { switching.current = false; fail(e); }
  };
  const connectHub = (id: string | null) => workIn(() => api.connect(id));
  const newHub = () => setAsk({ title: "New hub", label: "Name", ok: "Create", run: (n) => workIn(() => api.hubNew(n)) });
  const hub = hubId ? hubs.find((h) => h.id === hubId) : undefined;
  // save what is typed after a pause; the file is the record
  useEffect(() => {
    if (draft === null || !current || doc?.readOnly) return;
    const t = setTimeout(() => save(current, draft), 700);
    return () => clearTimeout(t);
  }, [draft, current, doc, save]);

  const text = draft ?? doc?.text ?? "";
  const debugging = runs.some((r) => r.debug && (r.state === "running" || r.state === "queued"));
  const command = useCallback((c: DebugCommand) => { api.debug(c).catch(fail); }, [fail]);
  const run = useCallback((kind: "file" | "cell" | "line", code?: string, line = 1, debug = false) => {
    if (kind === "file" && paused && !debug) return command("continue");   // F5 while a debug run waits goes on
    if (!current || typeOf(current) !== "jl") return;   // as the Run key: off, and its hover says why
    if (draft !== null && !doc?.readOnly) save(current, draft);
    const dbg = debug ? { debug: true, breakpoints: bps[current] ?? [] } : {};
    api.run(kind, kind === "file" ? { path: current, code: text, ...dbg } : { path: current, code, line, ...dbg }).catch(fail);
    setHidden((h) => (h.b ? { ...h, b: false } : h));
  }, [current, draft, doc, text, save, show, fail, paused, command, bps]);
  const setBreakpoints = useCallback((path: string, list: Breakpoint[]) => {
    setBps((m) => { const n = { ...m, [path]: list }; if (!list.length) delete n[path]; return n; });
    if (debugging) api.setBreakpoints(path, list).catch(() => {});   // the run that's going takes them at once
  }, [debugging]);
  const toggleBreakpoint = useCallback((path: string, line: number) => {
    const list = bps[path] ?? [];
    setBreakpoints(path, list.some((b) => b.line === line) ? list.filter((b) => b.line !== line) : [...list, { line, enabled: true }].sort((a, b) => a.line - b.line));
  }, [bps, setBreakpoints]);
  // the gutter's right click: add, remove, turn off, or give a breakpoint a condition (Julia code read where it stops)
  const bpItems = ({ path, line }: { path: string; line: number }): MenuEntry[] => {
    const list = bps[path] ?? [], b = list.find((x) => x.line === line);
    const put = (n: Breakpoint) => setBreakpoints(path, [...list.filter((x) => x.line !== line), n].sort((p, q) => p.line - q.line));
    const condition = () => setAsk({ title: `Condition for ${base(path)}:${line}`, label: "Stop when (Julia)", value: b?.condition ?? "", ok: b?.condition ? "Change" : "Add",
      text: "Julia code, read in the frame each time the line comes: it stops when this is true.",
      run: (c) => put({ ...(b ?? { line, enabled: true }), condition: c }) });
    return b
      ? [{ id: "bp-cond", label: b.condition ? "Edit condition…" : "Add condition…", run: condition },
          ...(b.condition ? [{ id: "bp-nocond", label: "Remove condition", run: () => put({ ...b, condition: undefined }) }] : []),
          { id: "bp-on", label: b.enabled === false ? "Enable breakpoint" : "Disable breakpoint", run: () => put({ ...b, enabled: b.enabled === false }) },
          "-", { id: "bp-rm", label: "Remove breakpoint", shortcut: "F9", run: () => toggleBreakpoint(path, line) }]
      : [{ id: "bp-add", label: "Add breakpoint", shortcut: "F9", run: () => toggleBreakpoint(path, line) },
          { id: "bp-addc", label: "Add conditional breakpoint…", run: condition }];
  };
  const runConsole = useCallback((code: string) => { api.run("console", { code }).catch(fail); }, [fail]);
  const runCellAtCursor = () => { const c = cellAt(text, cursor.line); if (c) run("cell", c.code, c.cell.from); };

  const newScript = useCallback((dir = current && !current.startsWith("@") ? dirOf(current) : "") => setAsk({
    title: "New script", label: "Name", value: "untitled.jl", ok: "Create",
    run: (name) => api.create(dir ? `${dir}/${name.endsWith(".jl") ? name : `${name}.jl`}` : name.endsWith(".jl") ? name : `${name}.jl`, NEW_SCRIPT).then((r) => { reload(); open(r.path); }, fail),
  }), [current, open, reload, fail]);
  const copyIn = useCallback((p: string) => api.copy(p, base(p)).then((r) => { reload(); open(r.path); }, fail), [open, reload, fail]);
  const copy = useCallback((t: string, what: string) => navigator.clipboard.writeText(t).then(() => show({ title: `${what} copied`, detail: t.length > 80 ? `${t.slice(0, 80)}…` : t, state: "done" }), fail), [show, fail]);

  const newFolder = (dir: string) => setAsk({ title: "New folder", label: "Name", ok: "Create", run: (n) => api.mkdir(dir ? `${dir}/${n}` : n).then(reload, fail) });
  const retab = (from: string, to: string) => {
    setTabs((t) => t.map((x) => (x === from ? to : x))); if (current === from) setCurrent(to);
    setPinned((s) => (s.has(from) ? new Set([...s].map((x) => (x === from ? to : x))) : s));
  };
  const rename = (p: string) => setAsk({ title: "Rename", label: "Path in the folder", value: p, ok: "Rename", run: (to) => to !== p && api.move(p, to).then(() => { reload(); retab(p, to); }, fail) });
  const trash = (p: string) => setAsk({ title: `Move ${p} to the trash?`, danger: true, ok: "Move to trash", text: "It goes to .julix/trash in the folder, so it can come back.",
    run: () => api.trash(p).then(() => { reload(); close(p); }, fail) });
  const into = (e?: FileEntry) => (!e ? "" : e.kind === "folder" ? e.path : dirOf(e.path));
  const treeActions: FileActions = {
    onOpen: (e) => e.kind === "file" && open(e.path),
    onNewFile: (e) => newScript(into(e)),
    onNewFolder: (e) => newFolder(into(e)),
    onRename: (e) => rename(e.path),
    onDuplicate: (e) => { api.copy(e.path, e.path).then((r) => { reload(); open(r.path); }, fail); },
    onDelete: (e) => trash(e.path),
    onCopyPath: (e) => { copy(e.path, "Path"); },
    onMove: (src, dst) => { const to = `${dst ? `${into(dst)}/` : ""}${src.name}`; if (to !== src.path) api.move(src.path, to).then(() => { reload(); retab(src.path, to); }, fail); },
  };
  const menuFor = (e?: FileEntry): MenuEntry[] => {
    if (!e || e.kind === "folder") {
      const dir = into(e);
      return [{ id: "new", label: "New script here", shortcut: "Ctrl N", run: () => newScript(dir) }, { id: "folder", label: "New folder here", run: () => newFolder(dir) },
        ...(e ? ["-" as const, { id: "rename", label: "Rename…", shortcut: "F2", run: () => rename(e.path) }, { id: "path", label: "Copy path", icon: "copy" as const, run: () => { copy(e.path, "Path"); } },
          { id: "reveal", label: "Reveal in file manager", run: () => { api.reveal(e.path).catch(fail); } }, "-" as const, { id: "trash", label: "Move to trash", icon: "trash" as const, shortcut: "Del", run: () => trash(e.path) }] : [])];
    }
    const t = typeOf(e.path), owner = ({ mo: "Articula", pst: "Simplicial", psf: "Simplicial", md: "Malachite" } as Record<string, string>)[t];
    return [
      { id: "open", label: "Open", shortcut: "Enter", run: () => open(e.path) },
      { id: "side", label: "Open to the side", run: () => open(e.path, true) },
      ...(owner ? [{ id: "in", label: `Open in ${owner}`, icon: "link-external" as const, disabled: true, why: `${owner} isn't connected to Julix yet`, run: () => {} }] : []),
      ...(t === "jl" ? ["-" as const, { note: "Julix" }, { id: "run", label: "Run", icon: "play" as const, shortcut: "F5", run: () => runPath(e.path) }] : []),
      "-", { id: "rename", label: "Rename…", shortcut: "F2", run: () => rename(e.path) }, { id: "dup", label: "Duplicate", run: () => treeActions.onDuplicate!(e) },
      "-", { id: "path", label: "Copy path", icon: "copy", run: () => { copy(e.path, "Path"); } }, { id: "reveal", label: "Reveal in file manager", run: () => { api.reveal(e.path).catch(fail); } },
      "-", { id: "trash", label: "Move to trash", icon: "trash", shortcut: "Del", run: () => trash(e.path) },
    ];
  };
  const exampleMenu = (e?: FileEntry): MenuEntry[] => (!e || e.kind === "folder" ? [] : [
    { id: "open", label: "Open", shortcut: "Enter", run: () => open(e.path) },
    "-", { note: "Julix" }, { id: "run", label: "Run", icon: "play", shortcut: "F5", run: () => runPath(e.path) }, { id: "copyin", label: "Copy to my folder", icon: "copy", run: () => copyIn(e.path) },
    "-", { id: "path", label: "Copy path", icon: "copy", run: () => { copy(e.path.replace(/^@examples\//, "examples/"), "Path"); } },
  ]);
  // a tab's menu: its own group (the closes, Pin), then the file's menu as the tree shows it, without Open
  const strip = orderTabs(tabs, pinned);
  const tabItems = (p: string): MenuEntry[] => {
    const e: FileEntry = { path: p, name: base(p), kind: "file", depth: 0 };
    const file = (p.startsWith("@examples/") ? exampleMenu(e) : menuFor(e)).filter((m) => typeof m === "string" || !("id" in m) || !["open", "side", "in"].includes(m.id));
    while (file[0] === "-") file.shift();
    return tabMenu(p, { tabs: strip, pinned, dirty: (t) => t === current && draft !== null }, {
      close: closeTabs, file,
      pin: (t, on) => setPinned((s) => { const n = new Set(s); if (on) n.add(t); else n.delete(t); return n; }),
    });
  };
  const runPath = (p: string) => { open(p); api.run("file", { path: p }).catch(fail); setHidden((h) => ({ ...h, b: false })); };
  const exampleActions: FileActions = {
    onOpen: (e) => e.kind === "file" && open(e.path),
    onDuplicate: (e) => { if (e.kind === "file") copyIn(e.path); },
    onCopyPath: (e) => { copy(e.path.replace(/^@examples\//, "examples/"), "Path"); },
  };

  // keys: Ctrl K search, Ctrl B / Ctrl Alt B / Ctrl Alt F / Ctrl J the panels, Ctrl N a script, F5 run, Ctrl , settings
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (chordMatches({ key: "k", ctrl: true }, e)) { e.preventDefault(); setSearch((s) => !s); return; }
      if (mod && k === "b") { e.preventDefault(); toggle(e.altKey ? "r" : "l"); return; }
      if (mod && e.altKey && k === "f") { e.preventDefault(); toggle("f"); return; }
      if (mod && k === "j") { e.preventDefault(); toggle("b"); return; }
      if (mod && e.key === ",") { e.preventDefault(); setDialog("settings"); return; }
      if (e.key === "F5" && mod && !e.defaultPrevented) { e.preventDefault(); run("file", undefined, 1, true); return; }
      if (e.key === "F5" && e.shiftKey && debugging) { e.preventDefault(); command("stop"); return; }
      if (e.key === "F6" && debugging && !paused) { e.preventDefault(); command("pause"); return; }
      if (paused && (e.key === "F10" || e.key === "F11")) { e.preventDefault(); command(e.key === "F10" ? "over" : e.shiftKey ? "out" : "into"); return; }
      if (e.key === "F5" && !e.defaultPrevented) { e.preventDefault(); run("file"); return; }
      if (e.key === "F1") { e.preventDefault(); setDialog("help"); return; }
      if (typing(e.target)) return;
      if (mod && k === "n") { e.preventDefault(); newScript(); }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [toggle, run, newScript, paused, debugging, command]);

  const searchItems: SearchItem[] = useMemo(() => [
    ...files(tree.files).map((p): SearchItem => ({ id: `f:${p}`, label: base(p), detail: dirOf(p), group: "Files", scope: "Files", icon: typeOf(p) === "jl" ? "file-code" : "file", run: () => open(p) })),
    ...files(tree.examples).map((p): SearchItem => ({ id: `e:${p}`, label: base(p), detail: "Examples · read-only", group: "Files", scope: "Files", icon: "file-code", run: () => open(p) })),
    ...variables.map((v): SearchItem => ({ id: `v:${v.name}`, label: v.name, detail: `${v.type} · ${v.summary.slice(0, 40)}`, group: "Variables", scope: "Variables", icon: "a-variables", run: () => { setWtab("vars"); toggle("r", false); } })),
    ...figures.map((f): SearchItem => ({ id: `g:${f.run}:${f.n}`, label: `Figure ${f.n}`, detail: `${base(f.source)} · ${f.time ? new Date(f.time).toTimeString().slice(0, 5) : ""}`, group: "Figures", scope: "Figures", icon: "file-media", run: () => { setShown({ run: f.run, n: f.n }); toggle("f", false); } })),
    { id: "c:debug", label: current ? `Debug ${base(current)}` : "Start debugging", detail: "stops at its breakpoints", shortcut: "Ctrl F5", group: "Commands", scope: "Commands", icon: "play", disabled: !current || typeOf(current) !== "jl" || debugging, why: debugging ? "A debug run is going" : "Open a .jl script first", run: () => run("file", undefined, 1, true) },
    { id: "c:run", label: current ? `Run ${base(current)}` : "Run the script", shortcut: "F5", group: "Commands", scope: "Commands", icon: "play", disabled: !current || typeOf(current) !== "jl", why: "Open a .jl script first", run: () => run("file") },
    { id: "c:cell", label: "Run cell", shortcut: "Ctrl Enter", group: "Commands", scope: "Commands", icon: "play", disabled: !doc || typeOf(doc.path) !== "jl", why: "Open a .jl script first", run: runCellAtCursor },
    { id: "c:stop", label: "Interrupt", shortcut: "Ctrl C", group: "Commands", scope: "Commands", icon: "debug-pause", disabled: !running, why: "Nothing is running", run: () => { api.interrupt().catch(fail); } },
    { id: "c:restart", label: "Restart the Julia session", detail: "clears the variables", group: "Commands", scope: "Commands", icon: "debug-restart", run: () => { api.restart().catch(fail); } },
    { id: "c:new", label: "New script", shortcut: "Ctrl N", group: "Commands", scope: "Commands", icon: "new-file", run: () => newScript() },
    { id: "c:copyin", label: "Copy this example to my folder", group: "Commands", scope: "Commands", icon: "copy", disabled: !current?.startsWith("@examples/"), why: "Open an example first", run: () => current && copyIn(current) },
    ...PANELS.map((p): SearchItem => ({ id: `p:${p.side}`, label: `${hidden[p.side] ? "Show" : "Hide"} ${p.name === "Figure" ? "the Figure" : p.name === "Console" ? "the Console" : p.name}`, shortcut: p.keys, group: "Commands", scope: "Commands", icon: "command", run: () => toggle(p.side) })),
    ...(["light", "dark", "system"] as Theme[]).map((t): SearchItem => ({ id: `t:${t}`, label: `Theme: ${t}`, group: "Commands", scope: "Commands", icon: `theme-${t}`, disabled: theme === t, why: "It is the theme now", run: () => setTheme(t) })),
    ...(hubs.length ? [{ id: "s:hub", label: "Connect to a hub…", detail: "Julix keeps its scripts, data and plots in a Malachite hub", group: "Settings", scope: "Settings", icon: "mark-malachite", run: () => setDialog("hub") } as SearchItem] : []),
    { id: "s:settings", label: "Settings", detail: "theme, packages", shortcut: "Ctrl ,", group: "Settings", scope: "Settings", icon: "a-settings", run: () => setDialog("settings") },
    { id: "s:packages", label: "Julia packages…", detail: "add JulixPlot, Plots, DataFrames…", group: "Settings", scope: "Settings", icon: "package", run: () => setDialog("packages") },
    { id: "h:help", label: "Help: Julia's docs", detail: "search names, read docstrings", shortcut: "F1", group: "Help", scope: "Help", icon: "question", run: () => setDialog("help") },
    { id: "h:manual", label: "Julix on GitHub", detail: "github.com/paperboatlab/julix", group: "Help", scope: "Help", icon: "link-external", run: () => { window.open("https://github.com/paperboatlab/julix#readme", "_blank", "noopener"); } },
    ...files(tree.examples).map((p): SearchItem => ({ id: `h:${p}`, label: `Example: ${base(p)}`, group: "Help", scope: "Help", icon: "book", run: () => open(p) })),
    { id: "h:about", label: "About Julix", detail: "version, runtime, licence", group: "Help", scope: "Help", icon: "info", run: () => setDialog("about") },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [debugging, tree, variables, figures, current, doc, running, hidden, theme, hubs, open, run, newScript, copyIn, toggle, fail, show]);
  // the hubs are read again as anything that shows them opens
  useEffect(() => { if (search || dialog === "settings" || dialog === "hub") readHubs(); }, [search, dialog, readHubs]);

  // Help (F1): Julia's own docs, from the session (the names it can reach, their docstrings); the shortcuts page
  // is the kit's, from the keys Julix answers
  const help = useMemo<HelpProvider>(() => ({
    items: (q) => api.helpItems(q).catch(() => []),
    page: (id) => api.helpPage(id).then((r) => ({ title: id, kind: "docstring", html: r.html || "<p>No docstring.</p>" }), () => null),
  }), []);
  const commands = useMemo<Command[]>(() => searchItems.filter((i) => i.shortcut).map((i) => ({ id: i.id, label: i.label, menu: "view", group: i.group, shortcut: i.shortcut, run: i.run })), [searchItems]);

  const isJl = !!current && typeOf(current) === "jl";
  const at = isJl ? cellAt(text, cursor.line) : null, nCells = isJl ? cells(text).length : 0;
  const shownFig = shown && figures.find((f) => f.run === shown.run && f.n === shown.n);
  const julia = runs.findLast((r) => r.runtime)?.runtime;

  return (
    <div className="win">
      <header className="bar">
        <AppMark app="julix" size={26} idle={!running} label="Julix" />
        <span className="wm">Julix</span>
        {hub
          ? <span className="proj-hub" onClickCapture={() => { readHubs(); }}>
              <HubSelector app="Julix" hub={kitHub(hub)} hubs={hubs.map(kitHub)} onSwitch={(id) => connectHub(id)} onNew={newHub}
                onOpenInMalachite={hub.missing ? undefined : () => { api.hubInMalachite(hub.id).then(() => show({ title: `${hub.name} opens in Malachite`, state: "done" }), fail); }}
                onDisconnect={() => connectHub(null)} />
            </span>
          : <span className="well proj" title={folder?.root}><TypeIcon name="" folder />{folder?.name ?? "…"}</span>}
        <span className="bend">
          {running
            ? debugging
              ? <Key busy onClick={() => command("stop")} title={`Stop debugging (${DEBUG_KEYS.stop})`}>{paused ? "paused" : <Elapsed since={now?.started} />}<Icon name="debug-stop" />Stop</Key>
              : <Key busy onClick={() => api.interrupt().catch(fail)} title="Interrupt (Ctrl C in the console)"><Elapsed since={now?.started} /><Icon name="debug-stop" />Stop</Key>
            : <Key kind="primary" icon="play" disabled={!isJl} onClick={() => run("file")} title={isJl ? `Run ${base(current!)} (F5)` : "Open a .jl script to run it"}>Run{isJl && <span className="runwhat">{base(current!)}</span>}</Key>}
          <RuntimesKey running={running} starting={session === "starting"} version={peekVersion} onPackages={() => setDialog("packages")} />
          <PanelsKey panels={PANELS.map((p) => ({ id: p.side, label: p.name, keys: p.keys, shown: !hidden[p.side] }))} layout={LAYOUT} onToggle={(id) => toggle(id as Side)} />
          <span className="lsep" />
          <Notifications {...notes} />
          <ThemePicker theme={theme} onChange={setTheme} />
        </span>
      </header>

      <main className="ws">
        <Panel name={folder?.name ?? "Files"} count={`${files(tree.files).length}`} side="left" hidden={hidden.l} onHidden={(h) => toggle("l", h)} icon="folder" width={FILES_W}
          head={<span className="tools"><Key size="sm" kind="quiet" round icon="new-file" label="New script (Ctrl N)" onClick={() => newScript("")} /><Key size="sm" kind="quiet" round icon="new-folder" label="New folder" onClick={() => newFolder("")} /></span>}>
          <FileTree entries={rows(tree.files)} active={current ?? undefined} actions={treeActions} menu={menuFor} ariaLabel="Files"
            labels={{ newFile: "New script", empty: "No files yet: make a script (Ctrl N), or copy an example." }} />
          {tree.examples.length > 0 && <>
            <div className="exh">Examples<small>read-only</small></div>
            <FileTree entries={rows(tree.examples)} active={current ?? undefined} actions={exampleActions} menu={exampleMenu} ariaLabel="Examples" />
          </>}
        </Panel>

        <div className="mid">
          <Split className={`top${hidden.f ? " fig-hidden" : ""}`} sized="end" size={hidden.f ? 38 : figW} defaultSize={figWidth()} min={320} otherMin={320}
            onSize={setFigW} onHidden={() => toggle("f", true)} label="Figure width">
            <section className="panel ed" aria-label="Script">
              <div className="ntabs">
                <div className="tabs2" role="tablist">
                  {strip.map((p) => (
                    <span key={p} role="tab" aria-selected={p === current} className={`${p === current ? "on" : ""}${tabAt?.path === p ? " ctx" : ""}`} onClick={() => open(p)}
                      onAuxClick={(e) => e.button === 1 && close(p)} onContextMenu={(e) => { e.preventDefault(); setTabAt({ path: p, x: e.clientX, y: e.clientY }); }}>
                      {busy?.path === p ? <Spinner size={12} label="Running" /> : <TypeIcon name={p} />}{base(p)}{p === current && draft !== null && !doc?.readOnly && <i className="dot" title="Saving" />}
                      {pinned.has(p)
                        ? <button type="button" className="tx" aria-label={`Unpin ${base(p)}`} title="Pinned: click to unpin" onClick={(e) => { e.stopPropagation(); setPinned((s) => new Set([...s].filter((x) => x !== p))); }}><Icon name="pin" size={12} /></button>
                        : <button type="button" className="tx" aria-label={`Close ${base(p)}`} onClick={(e) => { e.stopPropagation(); close(p); }}>×</button>}
                    </span>
                  ))}
                </div>
                {bpAt && <div className="file-menu own gmenu" style={{ left: Math.min(bpAt.x, innerWidth - 290), top: Math.min(bpAt.y, innerHeight - 200) }}>
                  <Menu label={`${base(bpAt.path)}:${bpAt.line}: breakpoint`} items={bpItems(bpAt)} onClose={() => setBpAt(null)} /></div>}
                {tabAt && <TabMenu path={tabAt.path} x={tabAt.x} y={tabAt.y} items={tabItems(tabAt.path)} onClose={() => setTabAt(null)} />}
                {isJl && <Key size="sm" kind="quiet" icon="play" onClick={runCellAtCursor} title="Run the cell at the cursor (Ctrl Enter)">Run cell</Key>}
                {doc && <EditorSettingsKey settings={editor} onSettings={setEditor} lintNote="Julia's parser" />}
              </div>
              {doc?.readOnly && (
                <div className="ro">An example: read-only. Run it as it is, or <button type="button" className="lnk" onClick={() => copyIn(doc.path)}>copy it to your folder</button> to change it.</div>
              )}
              <div className="body">
                {debugging && <DebugDock paused={!!paused} where={paused && `${base(paused.source)}:${paused.line}${paused.frames[0] ? ` · in ${paused.frames[0].name}` : ""}`}
                  onContinue={() => command("continue")} onPause={() => command("pause")} onStepOver={() => command("over")} onStepInto={() => command("into")}
                  onStepOut={() => command("out")} onStop={() => command("stop")} />}
                {!current && <div className="empty"><AppMark app="julix" size={72} idle label="" /><p>Open a script, or make one. The examples show how Julix runs code.</p>
                  <span className="row"><Key kind="primary" icon="new-file" onClick={() => newScript("")}>New script</Key>{tree.examples[0] && <Key onClick={() => open(files(tree.examples)[0])}>Open an example</Key>}</span></div>}
                {doc && doc.path === current && (IMAGE.has(typeOf(doc.path))
                  ? <div className="empty"><p>An image: Julix edits scripts and text.</p></div>
                  : <Code key={`${doc.path}:${doc.readOnly}:${doc.v}`} path={doc.path} text={text} readOnly={doc.readOnly} onChange={setDraft}
                      onPos={(p: EditorPos) => setCursor({ line: p.line, col: p.col })} busy={busy?.path === doc.path ? busy : undefined} settings={editor}
                      breakpoints={bps[doc.path]} onBreakpoint={(l) => toggleBreakpoint(doc.path, l)}
                      onBreakpointMenu={(line, x, y) => setBpAt({ path: doc.path, line, x, y })} stopAt={paused?.source === doc.path ? paused.line : undefined}
                      results={results[doc.path]} variables={variables} onFigure={(run, n) => { setShown({ run, n }); toggle("f", false); }} appTheme={appTheme}
                      session={session === "running" ? juliaSession : undefined}
                      run={{ cell: (c, l) => run("cell", c, l), line: (c, l) => run("line", c, l), file: () => run("file"), save: () => draft !== null && current && save(current, draft) }} />)}
              </div>
              {doc && isJl && (
                <div className="efoot"><span>Ln {cursor.line}, Col {cursor.col}{nCells > 1 && at ? ` · cell ${at.index + 1} of ${nCells}` : ""}</span>
                  <span className="bend"><span><kbd>Ctrl Enter</kbd> cell</span><span><kbd>Shift Enter</kbd> line</span><span><kbd>F5</kbd> file</span></span></div>
              )}
            </section>

            <Panel name={shownFig ? `Figure ${shownFig.n}` : "Figure"} count={shownFig ? base(shownFig.source) : undefined} side="right" hidden={hidden.f} onHidden={(h) => toggle("f", h)} icon="file-media" width={figW} className="figp"
              head={shownFig && <span className="tools">{shownFig.mime === FIGURE
                ? <Key size="sm" kind="quiet" onClick={() => setResetSeq((n) => n + 1)} title="Back to the scripted view">Reset view</Key>
                : <a className="key sm quiet" href={api.figure(shownFig)} download={`${base(shownFig.source).replace(/\.jl$/, "")}-figure-${shownFig.n}.${shownFig.mime === "image/png" ? "png" : "svg"}`} title="Save the figure">Export…</a>}</span>}>
              <div className="fbody">{shownFig
                ? <FigurePane f={shownFig} label={`Figure ${shownFig.n} of ${base(shownFig.source)}`} resetSeq={resetSeq} />
                : <div className="empty"><p>No figure yet. A JulixPlot figure appears here to pan, zoom and orbit; anything else your code shows as SVG or PNG appears as an image.</p></div>}</div>
            </Panel>
          </Split>

          <Console runs={runs} running={running} hidden={hidden.b} onHidden={(h) => toggle("b", h)} onRun={runConsole}
            onFigure={(run, n) => { setShown({ run, n }); toggle("f", false); }} />
        </div>

        <Panel name="Workspace" count={julia ? `julia ${julia.version}` : session === "starting" ? "starting…" : ""} side="right" hidden={hidden.r} onHidden={(h) => toggle("r", h)} icon="a-variables" width={WORKSPACE_W}>
          <Workspace tab={wtab} onTab={setWtab} variables={variables} figures={figures} shown={shown} onCopy={copy} onError={fail}
            onShow={(f) => { setShown(f); toggle("f", false); }} paused={!!paused}
            debug={<Debug paused={paused} debugging={debugging} current={isJl ? current : null} breakpoints={bps} onStart={() => run("file", undefined, 1, true)}
              onCommand={command} onBreakpoints={setBreakpoints} onOpen={(p) => open(p)} onError={fail} />} />
        </Panel>
      </main>

      {search && <Search items={searchItems} scopes={["All", "Files", "Variables", "Figures", "Commands", "Settings", "Help"]} placeholder={`Search ${folder?.name ?? "the folder"}, or run a command`} onClose={() => setSearch(false)} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "settings" && (
        <Dialog title="Settings" onClose={() => setDialog(null)} actions={<Key onClick={() => setDialog(null)}>Done</Key>}>
          <div className="sett">
            <span>Theme</span><Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
            <span>Julia packages</span><span><Key size="sm" onClick={() => setDialog("packages")}>Packages…</Key></span>
            {hubs.length > 0 && <><span>Hub</span><span>{hub && <span className="hub-now">{hub.name}</span>}<Key size="sm" onClick={() => setDialog("hub")}>{hub ? "Switch…" : "Connect to a hub…"}</Key></span></>}
          </div>
        </Dialog>
      )}
      {dialog === "hub" && <ConnectHub app="Julix" about="its scripts, data and plots" hubs={hubs.map(kitHub)} current={hubId ?? undefined}
        onConnect={(id) => { setDialog(null); if (id !== hubId) connectHub(id); }} onNew={() => { setDialog(null); newHub(); }}
        onFolder={() => { setDialog(null); if (hubId) connectHub(null); }} onClose={() => setDialog(null)} />}
      {dialog === "help" && <HelpWindow app="Julix" provider={help} commands={commands} onClose={() => setDialog(null)} />}
      {dialog === "about" && <AboutJulix version={folder?.version ?? ""} julia={julia} onClose={() => setDialog(null)} />}
      {dialog === "packages" && <Packages julia={julia?.version} onClose={() => setDialog(null)} notify={show} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/** What Julix itself ships; About adds the kit's libraries and the fonts. */
const CREDITS: Credit[] = [
  ["Julia", "the language and its runtime", "MIT", "https://julialang.org"],
  ["JulixPlot.jl", "figures", "MPL-2.0", "https://github.com/paperboatlab/JulixPlot.jl"],
  ["Cairo.jl, Colors.jl", "JulixPlot's drawing and colours", "MIT", "https://github.com/JuliaGraphics"],
  ["three.js", "3-D figures", "MIT", "https://threejs.org"],
];

function AboutJulix({ version, julia, onClose }: { version: string; julia?: Run["runtime"]; onClose: () => void }) {
  const [paperboat, setPaperboat] = useState<string | null>();
  useEffect(() => { api.paperboat().then((r) => setPaperboat(r.version), () => {}); }, []);
  return (
    <About app="julix" role="A Julia workbench" version={version} paperboat={paperboat} repo="paperboatlab/julix" credits={CREDITS} onClose={onClose}
      info={[julia ? `Julia ${julia.version}` : "Julia (starts with the first run)", julia?.backend, "paperboat-runtime/0"].filter(Boolean).join(" · ")} />
  );
}

function AskDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [v, setV] = useState(ask.value ?? "");
  const go = () => { if (!ask.label || v.trim()) { ask.run(v.trim()); onClose(); } };
  return (
    <Dialog title={ask.title} onClose={onClose} actions={<><Key kind={ask.danger ? "danger" : "primary"} onClick={go}>{ask.ok}</Key><Key onClick={onClose}>Cancel</Key></>}>
      {ask.label
        ? <label className="well ask"><input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} aria-label={ask.label} /><em>{ask.label}</em></label>
        : <p>{ask.text}</p>}
    </Dialog>
  );
}
