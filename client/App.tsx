// Julix's page (agent-docs/rebrand/apps/julix, and apps/files for the one file workflow): one window, no rail.
// The bar (mark, the menu bar, the workspace well, Run / Stop, the runtimes key, the Panels key, the window
// keys); Settings (File › Settings…, Ctrl ,) is the kit's window: General, Julix, Editor, Hub, Shortcuts; Files at the left; the script and its figure; the Workspace card at the right; the Console below.
// No workspace: the Start page in the bay. Everything shown comes from the app server; the files are the record.
import {
  About, AppMark, DebugDock, DEBUG_KEYS, Dialog, HelpWindow, Icon, Key, Menu, MenuBar, Notifications, Panel, PanelsKey, SEARCH_CHORD, Search, SettingRow, Settings, SettingsSection, ScaleSetting, ShortcutList, Spinner, Split, ThemeSetting, Toasts, WindowKeys, ExampleBanner, exampleCommands, exampleFromUrl, isScale, readStored, useScale, useShortcuts, useTheme, useToasts, writeStored,
  type Command, type Credit, type Example, type Scale, type HelpProvider, type MenuEntry, type PaneRect, type SearchItem, type Theme,
} from "@paperboatlab/ui";
import { EditorSettingsPane, EditorTabs, afterClose, orderTabs, tabMenu, useEditorSettings, type EditorPos } from "@paperboatlab/ui/editor";
import { FileTree, fileIconFor, type FileActions, type FileEntry } from "@paperboatlab/ui/files";
import { ConnectHub, HubMark, OpenFile, SaveFile, type Hub } from "@paperboatlab/ui/hub";
import { AskOpen, Start, TypedPath, Unsaved, WorkspaceWell, baseName, fileMenu, recentFor, recentMenu, shell, tilde, useOpening, type Opening, type RecentEntry } from "@paperboatlab/ui/workspace";
import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, listen, session as juliaSession, type Breakpoint, type DebugCommand, type Entry, type Figure, type HubInfo, type Paused, type Run, type Variable, type Workspace as Place } from "./api.ts";
import { cellAt, cells } from "./cells.ts";
import { Code } from "./Code.tsx";
import { Console } from "./Console.tsx";
import { JuliaRuntimes, PACKAGES } from "./Keys.tsx";
import { Workspace, type FigureRef, type WorkspaceTab } from "./Workspace.tsx";
import { Debug } from "./Debug.tsx";
import { applyRun, type Result } from "./results.ts";
import { FIGURE, Figure as FigurePane } from "./figure/Figure.tsx";

type Side = "l" | "f" | "b" | "r";
const PANELS: { side: Side; name: string; keys: string }[] = [
  { side: "l", name: "Files", keys: "Ctrl B" }, { side: "f", name: "Figure", keys: "Ctrl Alt F" },
  { side: "b", name: "Console", keys: "Ctrl J" }, { side: "r", name: "Workspace", keys: "Ctrl Alt B" },
];
const CHORDS: Record<Side, Command["chord"]> = { l: { key: "b", ctrl: true }, f: { key: "f", ctrl: true, alt: true }, b: { key: "j", ctrl: true }, r: { key: "b", ctrl: true, alt: true } };
/** The menu bar (REBRAND "Menu bar"): File, Edit, View, Julix's own Kernel, Help. */
const MENUS = [{ id: "file", label: "File" }, { id: "edit", label: "Edit" }, { id: "view", label: "View" }, { id: "kernel", label: "Kernel" }, { id: "help", label: "Help" }];
/** What Julix opens: the pickers' types. */
const TYPES = ["jl", "mx"];
// an example's window (paperboat#75): read before anything rewrites the URL
const opened = exampleFromUrl(location.search);
/** Before the page reloads in another workspace: it is no longer the example's window. */
const leaveExample = () => history.replaceState(null, "", location.pathname);
/** The window as the Panels key sketches it: files, editor, figure, console, workspace. */
const LAYOUT: Record<string, PaneRect> = { l: [4, 4, 10, 36], e: [16, 4, 16, 26], f: [34, 4, 12, 26], b: [16, 32, 30, 8], r: [48, 4, 12, 36] };
type Ask = { title: string; label?: string; value?: string; danger?: boolean; ok: string; text?: string; run: (v: string) => void };
type Doc = { path: string; text: string; v: number };   // v: a new copy from disk (remounts the editor)
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
/** A folder's icon, in the file tree's folder colour. */
function FolderGlyph() {
  const { icon, tone } = fileIconFor("", "folder");
  return <span className="fi" style={{ color: `var(--file-${tone})` }}><Icon name={icon} size={14} /></span>;
}
const kitHub = (h: HubInfo): Hub => ({ id: h.id, name: h.name, place: h.place, path: h.shown, missing: h.missing, conflicts: h.conflicts, holds: h.holds });
/** The entry at a path in the server's tree. */
const entryAt = (es: Entry[], p: string): Entry | undefined => {
  for (const e of es) { if (e.path === p) return e; const c = e.children && entryAt(e.children, p); if (c) return c; }
};
/** When a file changed: "today 14:12", else the day and time. */
const day = (ms: number) => {
  const d = new Date(ms), hm = d.toTimeString().slice(0, 5);
  return d.toDateString() === new Date().toDateString() ? `today ${hm}` : `${d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })} ${hm}`;
};
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`);
/** The editor on the page (CodeMirror's view), for the Edit menu. */
const editorView = () => { const el = document.querySelector<HTMLElement>(".ed .cm-editor"); return el ? EditorView.findFromDOM(el) : null; };
/** The script's path in the workspace, when a whole path lies inside it. */
const inside = (root: string, abs: string) => (abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : null);
const NEW_SCRIPT = "# A Julia script. F5 runs it; Ctrl Enter runs the cell at the cursor (a cell starts at ##).\n\n## First cell\n";

/** Seconds since a run started, ticking on its own so the whole page doesn't redraw. */
function Elapsed({ since }: { since?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(t); }, []);
  const s = since ? Math.max(0, (Date.now() - Date.parse(since)) / 1000) : 0;
  return <span className="mono">{s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`}</span>;
}

export function App() {
  // the theme every app starts in ($PAPERBOAT_HOME/settings.json; this browser's copy paints the first frame)
  const [theme, setThemeHere] = useState<Theme>(() => readStored("paperboat.theme", isTheme) ?? "system");
  const setTheme = useCallback((t: Theme) => { setThemeHere(t); api.setTheme(t).catch(() => {}); }, []);
  const appTheme = useTheme(theme);
  const [scale, setScaleHere] = useState<Scale>(() => readStored("paperboat.scale", isScale) ?? 1);
  const setScale = useCallback((s: Scale) => { setScaleHere(s); api.setScale(s).catch(() => {}); }, []);
  useScale(scale);
  const [editor, setEditor] = useEditorSettings(undefined, "julix.editor");   // ponytail: in localStorage until Julix keeps a settings file
  // what Julix works in: a folder, a hub, or nothing (the Start page); undefined till the server says
  const [info, setInfo] = useState<{ workspace: Place | null; home: string; version: string }>();
  const ws = info?.workspace ?? null;
  // the hubs Malachite knows: read when the page opens, and again as anything that shows them opens.
  // No Malachite, no hub: with none, nothing on the page mentions hubs.
  const [hubs, setHubs] = useState<HubInfo[]>([]);
  const readHubs = useCallback(() => api.hubs().then((l) => { setHubs(l); return l; }, () => [] as HubInfo[]), []);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const readRecent = useCallback(() => api.recent().then((r) => setRecent(r.recent), () => {}), []);
  const [tree, setTree] = useState<{ files: Entry[] }>({ files: [] });
  const [examples, setExamples] = useState<Example[]>([]);   // Open example: in Ctrl K, read once (paperboat#72)
  const [tabs, setTabs] = useState<string[]>(() => readStored("julix.tabs", isList) ?? []);
  const [current, setCurrent] = useState<string | null>(() => readStored("julix.tabs", isList)?.[0] ?? null);
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(readStored("julix.pinned", isList) ?? []));
  const [bpAt, setBpAt] = useState<{ path: string; line: number; x: number; y: number } | null>(null);   // the breakpoint gutter's right-click menu
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
  const [dialog, setDialog] = useState<"settings" | "about" | "help" | "hub" | "ask" | "open" | "save" | "folder" | "file" | "copy" | null>(null);
  const [settingsPage, setSettingsPage] = useState<string>();   // the page Settings opens on (Help › Keyboard shortcuts: "shortcuts")
  const settings = (page?: string) => { setSettingsPage(page); setDialog("settings"); };
  // unsaved changes before a file (or the folder or hub holding it) closes: what closes, and what then
  const [closing, setClosing] = useState<{ what?: string; then: () => void } | null>(null);
  const notes = useToasts();
  const { toasts, show, dismiss } = notes;
  const fail = useCallback((e: unknown) => show({ title: "Couldn't do that", detail: String((e as Error).message ?? e), state: "failed" }), [show]);
  const currentRef = useRef(current);
  const copies = useRef(0);
  const starting = useRef<number | null>(null);   // the "Starting Julia" toast, till the session is up or gave up
  const unsaved = useRef(new Map<string, number>());   // a file that failed to save: its toast, till a save goes through
  currentRef.current = current;
  const switching = useRef(false);   // this page moves the server to another folder: it reloads itself
  const opener = useOpening();   // a folder or hub on its way: Start, the well and Connect to a hub say so

  useEffect(() => writeStored("paperboat.theme", theme), [theme]);
  useEffect(() => writeStored("paperboat.scale", scale), [scale]);
  // another app may change them: read again when the window comes back
  useEffect(() => {
    const read = () => api.settings().then((v) => { setThemeHere(v.theme); setScaleHere(v.scale); }, () => {});
    read();
    addEventListener("focus", read);
    return () => removeEventListener("focus", read);
  }, []);
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
    readHubs(); readRecent(); api.examples().then(setExamples, () => {});
    api.workspace().then((v) => {
      setInfo(v); setSession(v.session);
      document.title = v.workspace ? `${v.workspace.name} · Julix` : "Julix";
      if (!v.workspace) return;
      // the tabs this browser kept belong to the workspace they were opened in
      if (readStored("julix.root", (x): x is string => typeof x === "string") !== v.workspace.root) { setTabs([]); setCurrent(null); setPinned(new Set()); }
      writeStored("julix.root", v.workspace.root);
      reload(); reloadFigures();
      api.variables().then(setVariables, () => {});
      api.runs().then((rs) => { setRuns(rs); setResults(rs.reduce(applyRun, {})); }, () => {});
      api.paused().then((r) => stopped(r.paused), () => {});
    }, fail);
  }, [reload, reloadFigures, readHubs, readRecent, fail, stopped]);

  const load = useCallback((p: string | null) => {
    if (!p) { setDoc(null); return; }
    api.file(p).then((d) => { if (currentRef.current === p) { setDoc({ ...d, v: ++copies.current }); setDraft(null); } }, (e) => { setDoc(null); fail(e); });
    if (!p.startsWith("@")) api.opened(p).catch(() => {});   // first in recent.json
  }, [fail]);
  useEffect(() => { if (ws) load(current); }, [ws, current, load]);

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
    else if (e.type === "folder" && !switching.current) { leaveExample(); location.reload(); }   // another page moved the server to another workspace
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

  // a deep link opens a file (the Launcher and other apps use it): /?open=<path in the workspace>, or a whole
  // path, which brings its folder or hub as File › Open file… does
  useEffect(() => {
    const p = new URLSearchParams(location.search).get("open");
    if (!p) return;
    if (!/^(\/|~)/.test(p)) { open(p); return; }
    const rest = new URLSearchParams(location.search); rest.delete("open");   // the example's params stay
    history.replaceState(null, "", `${location.pathname}${rest.size ? `?${rest}` : ""}`);
    switching.current = true;   // the server may move: this page reloads itself, not on the event
    api.workspace().then((was) => api.openPath(p).then((r) => {
      if (was.workspace?.root === r.workspace.root) { switching.current = false; open(r.path); return; }
      writeStored("julix.root", r.workspace.root); writeStored("julix.tabs", [r.path]); writeStored("julix.pinned", []);
      leaveExample(); location.reload();
    })).catch((e) => { switching.current = false; fail(e); });
  }, [open, fail]);
  const save = useCallback(async (p: string, text: string) => {
    const id = unsaved.current.get(p);
    try {
      await api.save(p, text); setDraft((d) => (d === text ? null : d)); setDoc((d) => (d && d.path === p ? { ...d, text } : d));
      if (id !== undefined) { unsaved.current.delete(p); show({ id, title: `${base(p)} saved`, state: "done" }); }
      return true;
    } catch (e) {
      // autosave retries on the next pause; one toast per file, not one per try
      unsaved.current.set(p, show({ id, title: `Couldn't save ${base(p)}`, detail: `${(e as Error).message ?? e} · the text stays in the editor`, state: "failed" }));
      return false;
    }
  }, [show]);
  // only the shown tab can be unsaved (the rest were saved as they were left): before it closes, alone or with
  // its folder or hub, Unsaved asks: Save, Don't save, Cancel
  const dirty = !!current && draft !== null;
  const guard = (what: string | undefined, then: () => void) => (dirty ? setClosing({ what, then }) : then());
  const closeTabs = (paths: string[]) => {
    const go = () => {
      const next = afterClose(tabs, current, paths);
      setTabs(next.tabs); setCurrent(next.current);
      setPinned((s) => (paths.some((p) => s.has(p)) ? new Set([...s].filter((p) => !paths.includes(p))) : s));
    };
    if (current && paths.includes(current)) guard(undefined, go); else go();
  };
  const close = (p: string) => closeTabs([p]);

  // the one file workflow: the server switches the workspace (a folder, a hub, none), the page reloads on it
  const home = info?.home;
  const sh = shell();
  // `what`: the folder, file or hub on its way: Start, the well and Connect to a hub say so until the page reloads in it
  const switchTo = (what: Omit<Opening, "error" | "detail"> | null, go: () => Promise<Place | null | { workspace: Place; path: string }>, ask = true) => {
    const work = async () => {
      switching.current = true;
      const r = await go();
      const w = r && "path" in r ? r.workspace : r as Place | null;
      writeStored("julix.root", w?.root ?? null); writeStored("julix.tabs", r && "path" in r ? [r.path] : []); writeStored("julix.pinned", []);
      leaveExample(); location.reload();
    };
    const run = () => (what ? opener.open(what, work) : work()).catch((e) => { switching.current = false; fail(e); });
    if (ask) guard(ws?.kind === "hub" ? "the hub" : "the folder", run); else run();
  };
  /** A file by its whole path (`~` the home folder): in the workspace it opens; from outside, the workspace follows it. */
  const openAbs = (p: string) => {
    const abs = home && /^~(\/|$)/.test(p.trim()) ? home + p.trim().slice(1) : p.trim();
    const rel = ws && inside(ws.root, abs);
    if (rel) open(rel); else switchTo({ name: baseName(abs), path: p }, () => api.openPath(abs));
  };
  const pickLocal = () => {
    setDialog(null);
    if (sh) sh.pickFile(TYPES, "Open a script").then((p) => p && openAbs(p), fail); else setDialog("file");
  };
  // Open file…: in a hub, our picker over it; outside, with Malachite, ask (a local file, or a hub); else the local file
  const openFile = () => { if (ws?.kind === "hub") setDialog("open"); else if (hubs.length) { readHubs(); setDialog("ask"); } else pickLocal(); };
  const openFolder = () => {
    if (sh) sh.pickFolder("Open folder").then((p) => p && switchTo({ name: baseName(p), path: p }, () => api.workIn({ kind: "folder", path: p })), fail); else setDialog("folder");
  };
  // the example banner's Copy: into the folder it was opened from, else one picked as Open folder… picks;
  // the CLI opens the copy in a new window
  const copyTo = (to: string) => api.copyExample(opened!.id, to).then((r) => show({ title: `Copied to ${tilde(r.path, home)}`, state: "done" }), fail);
  const copyExample = () => {
    if (opened?.to) copyTo(opened.to);
    else if (sh) sh.pickFolder("Copy the example to").then((p) => { if (p) copyTo(p); }, fail); else setDialog("copy");
  };
  const connect = () => { readHubs(); setDialog("hub"); };
  const toHub = (id: string) => switchTo({ name: hubs.find((h) => h.id === id)?.name ?? "the hub", hub: id }, () => api.workIn({ kind: "hub", id }));
  const closeWorkspace = () => switchTo(null, () => api.workIn({ kind: null }));
  const newHub = () => setAsk({ title: "New hub", label: "Name", ok: "Create", run: (n) => switchTo({ name: n }, () => api.hubNew(n)) });
  const openRecent = (e: RecentEntry) => {
    if (e.kind === "file") openAbs(e.path);
    else if (e.kind === "hub" && e.hub && hubs.some((h) => h.id === e.hub)) toHub(e.hub);   // by its id: a moved hub is found
    else switchTo({ name: baseName(e.path), path: e.path }, () => api.workIn({ kind: "folder", path: e.path }));   // the server knows a hub's folder
  };
  const recentItems = recentMenu(recentFor({ version: 1, recent }, "julix", { hubs: hubs.length > 0 }), openRecent,
    () => { api.clearRecent().then(() => setRecent([]), fail); });
  const hub = ws?.kind === "hub" ? hubs.find((h) => h.id === ws.hub) : undefined;
  // the hub's picker needs the hub: before the list is read, what the workspace says of it
  const pickHub: Hub = hub ? kitHub(hub) : { id: ws?.hub ?? "", name: ws?.name ?? "", place: "local", path: ws ? tilde(ws.root, home) : "" };
  const saveNow = () => { if (current && dirty) save(current, draft!); };
  // Save as…: in a hub, our picker over it; in a Paperboat window, the system's dialog; in a browser, a download
  const saveAs = () => {
    if (!current) return;
    const body = draft ?? doc?.text ?? "";
    if (ws?.kind === "hub") return setDialog("save");
    if (sh) {
      sh.pickSave(base(current), TYPES, "Save as").then((p) => {
        const rel = p && ws && inside(ws.root, p);
        if (rel) api.save(rel, body).then(() => { reload(); open(rel); }, fail);
        else if (p) switchTo(null, () => api.saveAs(p, body), false);   // the old file keeps what it had on disk
      }, fail);
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/plain" })); a.download = base(current); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  // save what is typed after a pause; the file is the record
  useEffect(() => {
    if (draft === null || !current || closing) return;   // not while Unsaved asks
    const t = setTimeout(() => save(current, draft), 700);
    return () => clearTimeout(t);
  }, [draft, current, doc, save, closing]);

  const text = draft ?? doc?.text ?? "";
  const debugging = runs.some((r) => r.debug && (r.state === "running" || r.state === "queued"));
  const command = useCallback((c: DebugCommand) => { api.debug(c).catch(fail); }, [fail]);
  const run = useCallback((kind: "file" | "cell" | "line", code?: string, line = 1, debug = false) => {
    if (kind === "file" && paused && !debug) return command("continue");   // F5 while a debug run waits goes on
    if (!current || typeOf(current) !== "jl") return;   // as the Run key: off, and its hover says why
    if (draft !== null) save(current, draft);
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

  // New script: in the workspace, a name; with none, where it goes (the system's dialog, or a typed path)
  const newScript = (dir = current && !current.startsWith("@") ? dirOf(current) : "") => {
    if (!ws) {
      if (sh) sh.pickSave("untitled.jl", ["jl"], "New script").then((p) => p && switchTo(null, () => api.saveAs(p, NEW_SCRIPT)), fail);
      else setAsk({ title: "New script", label: "Whole path", value: `${home ? "~" : ""}/untitled.jl`, ok: "Create",
        run: (p) => switchTo(null, () => api.saveAs(home && /^~(\/|$)/.test(p) ? home + p.slice(1) : p, NEW_SCRIPT, true)) });
      return;
    }
    setAsk({
      title: "New script", label: "Name", value: "untitled.jl", ok: "Create",
      run: (name) => api.create(dir ? `${dir}/${name.endsWith(".jl") ? name : `${name}.jl`}` : name.endsWith(".jl") ? name : `${name}.jl`, NEW_SCRIPT).then((r) => { reload(); open(r.path); }, fail),
    });
  };
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
  // a tab's menu: its own group (the closes, Pin), then the file's menu as the tree shows it, without Open
  const strip = orderTabs(tabs, pinned);
  const tabItems = (p: string): MenuEntry[] => {
    const e: FileEntry = { path: p, name: base(p), kind: "file", depth: 0 };
    const file = menuFor(e).filter((m) => typeof m === "string" || !("id" in m) || !["open", "side", "in"].includes(m.id));
    while (file[0] === "-") file.shift();
    return tabMenu(p, { tabs: strip, pinned, dirty: (t) => t === current && draft !== null }, {
      close: closeTabs, file,
      pin: (t, on) => setPinned((s) => { const n = new Set(s); if (on) n.add(t); else n.delete(t); return n; }),
    });
  };
  const runPath = (p: string) => { open(p); api.run("file", { path: p }).catch(fail); setHidden((h) => ({ ...h, b: false })); };

  // the run and debug keys (the editor has its own: Ctrl Enter, Shift Enter); every chord with Ctrl is the registry's
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "F5" && mod && !e.defaultPrevented) { e.preventDefault(); run("file", undefined, 1, true); return; }
      if (e.key === "F5" && e.shiftKey && debugging) { e.preventDefault(); command("stop"); return; }
      if (e.key === "F6" && debugging && !paused) { e.preventDefault(); command("pause"); return; }
      if (paused && (e.key === "F10" || e.key === "F11")) { e.preventDefault(); command(e.key === "F10" ? "over" : e.shiftKey ? "out" : "into"); return; }
      if (e.key === "F5" && !e.defaultPrevented) { e.preventDefault(); run("file"); return; }
      if (e.key === "F1") { e.preventDefault(); setDialog("help"); }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [run, paused, debugging, command]);

  // the command registry: the menu bar, the command search and the shortcuts read it (REBRAND "Menu bar")
  const view = editorView;
  const noScript = { enabled: !!current && typeOf(current) === "jl", why: "open a .jl script first" };
  const commands: Command[] = [
    ...fileMenu({
      noun: "script", workspace: ws, file: !!current, hubs: hubs.length > 0, recent: recentItems,
      onNew: () => newScript(), onOpenFile: openFile, onOpenFolder: openFolder, onConnect: connect, onSave: saveNow, onSaveAs: saveAs,
      onCloseFile: () => { if (current) close(current); }, onCloseWorkspace: closeWorkspace, onSettings: () => settings(),
    }),
    { id: "edit.undo", label: "Undo", menu: "edit", group: "history", shortcut: "Ctrl Z", enabled: !!doc, why: "no script open", run: () => { const v = view(); if (v) undo(v); } },
    { id: "edit.redo", label: "Redo", menu: "edit", group: "history", shortcut: "Ctrl Shift Z", enabled: !!doc, why: "no script open", run: () => { const v = view(); if (v) redo(v); } },
    { id: "edit.find", label: "Find and replace…", menu: "edit", group: "find", shortcut: "Ctrl F", enabled: !!doc, why: "no script open", run: () => { const v = view(); if (v) openSearchPanel(v); } },
    { id: "view.search", label: "Search…", menu: "view", group: "search", shortcut: "Ctrl K", chord: SEARCH_CHORD, quiet: true, run: () => setSearch((x) => !x) },
    ...PANELS.map((p): Command => ({ id: `view.${p.name.toLowerCase()}`, label: p.name, menu: "view", group: "panels", shortcut: p.keys, chord: CHORDS[p.side], checked: !hidden[p.side], run: () => toggle(p.side) })),
    ...(["light", "dark", "system"] as Theme[]).map((t): Command => ({ id: `view.theme.${t}`, label: t[0].toUpperCase() + t.slice(1), menu: "view", group: "theme", checked: theme === t, run: () => setTheme(t) })),
    { id: "kernel.run", label: current ? `Run ${base(current)}` : "Run the script", menu: "kernel", group: "run", shortcut: "F5", icon: "play", ...noScript, run: () => run("file") },
    { id: "kernel.cell", label: "Run cell", menu: "kernel", group: "run", shortcut: "Ctrl Enter", ...noScript, run: () => runCellAtCursor() },
    { id: "kernel.debug", label: current ? `Debug ${base(current)}` : "Start debugging", menu: "kernel", group: "run", shortcut: "Ctrl F5", ...noScript,
      ...(debugging ? { enabled: false, why: "a debug run is going" } : {}), run: () => run("file", undefined, 1, true) },
    { id: "kernel.interrupt", label: "Interrupt", menu: "kernel", group: "session", icon: "debug-pause", enabled: running, why: "nothing is running", run: () => { api.interrupt().catch(fail); } },
    { id: "kernel.restart", label: "Restart the Julia session", menu: "kernel", group: "session", icon: "debug-restart", enabled: !!ws, why: "no folder open", run: () => { api.restart().catch(fail); } },
    { id: "kernel.runtimes", label: "Manage runtimes…", menu: "kernel", group: "packages", icon: "a-runtimes", run: () => { api.manageRuntimes().catch(fail); } },
    { id: "kernel.packages", label: "Julia packages…", menu: "kernel", group: "packages", icon: "package", enabled: false, why: PACKAGES, run: () => {} },
    { id: "help.docs", label: "Julia's docs", menu: "help", group: "docs", shortcut: "F1", icon: "question", run: () => setDialog("help") },
    // Ctrl / in the script is the editor's (comment the lines); everywhere else it opens Settings › Shortcuts
    { id: "help.shortcuts", label: "Keyboard shortcuts", menu: "help", group: "docs", shortcut: "Ctrl /", chord: { key: "/", ctrl: true }, icon: "keys",
      run: () => { if (!document.activeElement?.closest('.cm-content[contenteditable="true"]')) settings("shortcuts"); } },
    { id: "help.manual", label: "Julix on GitHub", menu: "help", group: "docs", icon: "link-external", run: () => { window.open("https://github.com/paperboatlab/julix#readme", "_blank", "noopener"); } },
    { id: "help.about", label: "About Julix", menu: "help", group: "about", icon: "info", run: () => setDialog("about") },
    // Open example: <name>, only in Ctrl K: the CLI opens it where it is, in a new window with the example banner
    ...exampleCommands(examples, (id) => { api.openExample(id).catch(fail); }),
  ];
  useShortcuts(commands);
  const searchItems: SearchItem[] = [
    ...files(tree.files).map((p): SearchItem => ({ id: `f:${p}`, label: base(p), detail: dirOf(p), group: "Files", scope: "Files", icon: typeOf(p) === "jl" ? "file-code" : "file", run: () => open(p) })),
    ...variables.map((v): SearchItem => ({ id: `v:${v.name}`, label: v.name, detail: `${v.type} · ${v.summary.slice(0, 40)}`, group: "Variables", scope: "Variables", icon: "a-variables", run: () => { setWtab("vars"); toggle("r", false); } })),
    ...figures.map((f): SearchItem => ({ id: `g:${f.run}:${f.n}`, label: `Figure ${f.n}`, detail: `${base(f.source)} · ${f.time ? new Date(f.time).toTimeString().slice(0, 5) : ""}`, group: "Figures", scope: "Figures", icon: "file-media", run: () => { setShown({ run: f.run, n: f.n }); toggle("f", false); } })),
    ...commands.filter((c) => !c.quiet).map((c): SearchItem => {
      const g = c.menu === "help" ? "Help" : "Commands", on = typeof c.enabled === "function" ? c.enabled() : c.enabled ?? true;
      return { id: c.id, label: c.menu === "view" && c.group === "theme" ? `Theme: ${c.label}` : c.menu === "view" && c.group === "panels" ? `${c.checked ? "Hide" : "Show"} ${c.label}` : c.label,
        shortcut: c.shortcut, group: g, scope: g, icon: c.icon ?? "command", disabled: !on, why: c.why, run: c.run };
    }),
  ];
  // the hubs are read again as anything that shows them opens
  useEffect(() => { if (search || dialog === "settings") readHubs(); }, [search, dialog, readHubs]);

  // Help (F1): Julia's own docs, from the session (the names it can reach, their docstrings); the shortcuts page
  // is the kit's, from the keys Julix answers
  const help = useMemo<HelpProvider>(() => ({
    items: (q) => api.helpItems(q).catch(() => []),
    page: (id) => api.helpPage(id).then((r) => ({ title: id, kind: "docstring", html: r.html || "<p>No docstring.</p>" }), () => null),
  }), []);

  const isJl = !!current && typeOf(current) === "jl";
  const at = isJl ? cellAt(text, cursor.line) : null, nCells = isJl ? cells(text).length : 0;
  const shownFig = shown && figures.find((f) => f.run === shown.run && f.n === shown.n);
  const julia = runs.findLast((r) => r.runtime)?.runtime;

  return (
    <div className="win frame">
      <header className="bar">
        <span className="lk"><AppMark app="julix" size={26} idle={!running} label="Julix" /><span className="wm">Julix</span></span>
        <MenuBar commands={commands} menus={MENUS} groupTitles={{ theme: "Theme" }} />
        {ws && <WorkspaceWell workspace={ws} home={home} recent={recentItems} hubs={hubs.map(kitHub)} opening={opener.opening} onOpenFolder={openFolder} onConnect={connect}
          onClose={closeWorkspace} onSwitchHub={toHub} onNewHub={newHub} onUseFolder={openFolder}
          onOpenInMalachite={hub && !hub.missing ? () => { api.hubInMalachite(hub.id).then(() => show({ title: `${hub.name} opens in Malachite`, state: "done" }), fail); } : undefined} />}
        <span className="bend">
          {!ws ? null : running
            ? debugging
              ? <Key busy onClick={() => command("stop")} title={`Stop debugging (${DEBUG_KEYS.stop})`}>{paused ? "paused" : <Elapsed since={now?.started} />}<Icon name="debug-stop" />Stop</Key>
              : <Key busy onClick={() => api.interrupt().catch(fail)} title="Interrupt (Ctrl C in the console)"><Elapsed since={now?.started} /><Icon name="debug-stop" />Stop</Key>
            : <Key kind="primary" icon="play" disabled={!isJl} onClick={() => run("file")} title={isJl ? `Run ${base(current!)} (F5)` : "Open a .jl script to run it"}>Run{isJl && <span className="runwhat">{base(current!)}</span>}</Key>}
          <JuliaRuntimes running={running} starting={session === "starting"} version={peekVersion} />
          <Notifications {...notes} />
          <PanelsKey panels={PANELS.map((p) => ({ id: p.side, label: p.name, keys: p.keys, shown: !hidden[p.side] }))} layout={LAYOUT} onToggle={(id) => toggle(id as Side)} />
          <WindowKeys />
        </span>
      </header>

      {info && !ws && <main className="ws start"><div className="mid bay"><section className="panel start-card">
        <Start app="Julix" noun="script" nouns="scripts" hubs={hubs.length > 0} recent={recent} home={home} opening={opener.opening} onOpenFolder={openFolder} onOpenFile={openFile}
          onNew={() => newScript()} onConnect={connect} onRecent={openRecent} onDrop={(e) => {
            // a Paperboat window gives a dropped file's path; a browser can't say where it lives: type it
            const f = e.dataTransfer.files[0] as (File & { path?: string }) | undefined;
            if (f?.path) { if (f.type || /\.\w+$/.test(f.name)) openAbs(f.path); else switchTo({ name: baseName(f.path), path: f.path }, () => api.workIn({ kind: "folder", path: f.path! })); }
            else setDialog(f && /\.\w+$/.test(f.name) ? "file" : "folder");
          }} />
      </section></div></main>}
      {ws && <main className="ws">
        <Panel name="Files" count={`${files(tree.files).length}`} side="left" hidden={hidden.l} onHidden={(h) => toggle("l", h)} icon="folder" width={FILES_W} className="filesp"
          tools={<><Key size="sm" kind="quiet" round icon="new-file" label="New script (Ctrl N)" onClick={() => newScript("")} /><Key size="sm" kind="quiet" round icon="new-folder" label="New folder" onClick={() => newFolder("")} /></>}>
          <FileTree entries={rows(tree.files)} active={current ?? undefined} actions={treeActions} menu={menuFor} ariaLabel="Files"
            labels={{ newFile: "New script", empty: "No files yet: make a script (Ctrl N), or open an example (Ctrl K)." }} />
          <div className="sfoot" title={ws.root}>{ws.kind === "hub" ? <><HubMark size={14} /><code>history kept by Malachite</code></> : <><FolderGlyph /><code>{tilde(ws.root, home)}</code></>}</div>
        </Panel>

        <div className="mid bay">
          {opened && <ExampleBanner name={opened.name} folder={opened.to && tilde(opened.to, home)} cache={opened.cache} onCopy={copyExample} />}
          <Split className={`top${hidden.f ? " fig-hidden" : ""}`} sized="end" size={hidden.f ? 38 : figW} defaultSize={figWidth()} min={320} otherMin={320}
            onSize={setFigW} onHidden={() => toggle("f", true)} label="Figure width">
            <section className="panel ed" aria-label="Script">
              <EditorTabs label="Open scripts" current={current} onShow={open} onClose={close} menu={tabItems}
                tabs={strip.map((p) => ({ id: p, icon: busy?.path === p ? <Spinner size={12} label="Running" /> : undefined, dirty: p === current && draft !== null, pinned: pinned.has(p) }))}
                onUnpin={(p) => setPinned((s) => new Set([...s].filter((x) => x !== p)))}>
                {isJl && <Key size="sm" kind="quiet" icon="play" onClick={runCellAtCursor} title="Run the cell at the cursor (Ctrl Enter)">Run cell</Key>}
              </EditorTabs>
              {bpAt && <div className="file-menu own gmenu" style={{ left: Math.min(bpAt.x, innerWidth - 290), top: Math.min(bpAt.y, innerHeight - 200) }}>
                <Menu label={`${base(bpAt.path)}:${bpAt.line}: breakpoint`} items={bpItems(bpAt)} onClose={() => setBpAt(null)} /></div>}
              <div className="body">
                {debugging && <DebugDock paused={!!paused} where={paused && `${base(paused.source)}:${paused.line}${paused.frames[0] ? ` · in ${paused.frames[0].name}` : ""}`}
                  onContinue={() => command("continue")} onPause={() => command("pause")} onStepOver={() => command("over")} onStepInto={() => command("into")}
                  onStepOut={() => command("out")} onStop={() => command("stop")} />}
                {!current && <div className="empty-state"><div className="welcome"><AppMark app="julix" size={72} idle label="" /><p>Open a script, or make one. The examples open from Ctrl K: Open example.</p>
                  <span><Key kind="primary" icon="new-file" onClick={() => newScript("")}>New script</Key></span></div></div>}
                {doc && doc.path === current && (IMAGE.has(typeOf(doc.path))
                  ? <p className="empty-state">An image: Julix edits scripts and text.</p>
                  : <Code key={`${doc.path}:${doc.v}`} path={doc.path} text={text} onChange={setDraft}
                      onPos={(p: EditorPos) => setCursor({ line: p.line, col: p.col })} busy={busy?.path === doc.path ? busy : undefined} settings={editor}
                      breakpoints={bps[doc.path]} onBreakpoint={(l) => toggleBreakpoint(doc.path, l)}
                      onBreakpointMenu={(line, x, y) => setBpAt({ path: doc.path, line, x, y })} stopAt={paused?.source === doc.path ? paused.line : undefined}
                      results={results[doc.path]} variables={variables} onFigure={(run, n) => { setShown({ run, n }); toggle("f", false); }} appTheme={appTheme}
                      session={session === "running" ? juliaSession : undefined}
                      run={{ cell: (c, l) => run("cell", c, l), line: (c, l) => run("line", c, l), file: () => run("file"), save: () => draft !== null && current && save(current, draft) }} />)}
              </div>
              {doc && isJl && (
                <div className="efoot"><span>Ln {cursor.line}, Col {cursor.col}{nCells > 1 && at ? ` · cell ${at.index + 1} of ${nCells}` : ""}</span>
                  <span className="efoot-keys"><span><kbd className="kbd">Ctrl Enter</kbd> cell</span><span><kbd className="kbd">Shift Enter</kbd> line</span><span><kbd className="kbd">F5</kbd> file</span></span></div>
              )}
            </section>

            <Panel name={shownFig ? `Figure ${shownFig.n}` : "Figure"} count={shownFig ? base(shownFig.source) : undefined} side="right" hidden={hidden.f} onHidden={(h) => toggle("f", h)} icon="file-media" width={figW} className="figp"
              tools={shownFig && (shownFig.mime === FIGURE
                ? <Key size="sm" kind="quiet" onClick={() => setResetSeq((n) => n + 1)} title="Back to the scripted view">Reset view</Key>
                : <a className="key sm quiet" href={api.figure(shownFig)} download={`${base(shownFig.source).replace(/\.jl$/, "")}-figure-${shownFig.n}.${shownFig.mime === "image/png" ? "png" : "svg"}`} title="Save the figure">Export…</a>)}>
              <div className="fbody">{shownFig
                ? <FigurePane f={shownFig} label={`Figure ${shownFig.n} of ${base(shownFig.source)}`} resetSeq={resetSeq} />
                : <p className="empty-state">No figure yet. A JulixPlot figure appears here to pan, zoom and orbit; anything else your code shows as SVG or PNG appears as an image.</p>}</div>
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
      </main>}

      {search && <Search items={searchItems} scopes={["All", "Files", "Variables", "Figures", "Commands", "Help"]} placeholder={ws ? `Search ${ws.name}, or run a command` : "Run a command"} onClose={() => setSearch(false)} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "settings" && <Settings app="Julix" page={settingsPage} onClose={() => setDialog(null)} pages={[
        { id: "general", label: "General", icon: "a-settings", body: <><ThemeSetting theme={theme} onTheme={setTheme} /><ScaleSetting scale={scale} onScale={setScale} /></> },
        { id: "julix", label: "Julix", icon: "mark-julix", body: <JuliaSettings ws={ws} home={home} julia={julia} /> },
        { id: "editor", label: "Editor", icon: "file-code", body: <EditorSettingsPane settings={editor} onSettings={setEditor} lintNote="Julia's parser" /> },
        ...(ws?.kind === "hub" ? [{ id: "hub", label: "Hub", icon: "mark-malachite" as const, body: <>
          <SettingsSection title="The hub">
            <SettingRow label="Name" hint="Julix keeps its scripts, data and figures here">
              <span className="well">{ws.name}</span><Key size="sm" onClick={connect}>Switch hub…</Key>
            </SettingRow>
            <SettingRow label="Folder" hint={hub && hub.place !== "local" ? "In the cloud: its app on this computer keeps it in sync" : "On this computer"}>
              <span className="well path" title={ws.root}><span>{`\u200e${hub?.shown ?? tilde(ws.root, home)}`}</span></span>
            </SettingRow>
            <SettingRow label="Close hub" hint="Julix goes back to its Start page; the hub and its files stay">
              <Key size="sm" onClick={closeWorkspace}>Close hub</Key>
            </SettingRow>
          </SettingsSection>
          <p className="settings-note">The hub's own settings (its author, history, what it leaves out) are set in Malachite.</p>
        </> }] : []),
        { id: "shortcuts", label: "Shortcuts", icon: "keys", body: <ShortcutList commands={[...commands, ...EDITOR_KEYS]} menus={MENUS} /> },
      ]} />}
      {dialog === "hub" && <ConnectHub app="Julix" hubs={hubs.map(kitHub)} opening={opener.opening} onClose={() => setDialog(null)}
        onConnect={(id) => { setDialog(null); if (id !== ws?.hub) toHub(id); }} onNew={() => { setDialog(null); newHub(); }} />}
      {dialog === "ask" && <AskOpen what="a script" types={TYPES} hubs={hubs.length} onLocal={pickLocal} onConnect={connect} onClose={() => setDialog(null)} />}
      {dialog === "open" && <OpenFile what="a script" types={TYPES} kinds="Scripts" hub={pickHub} list={async () => rows(tree.files)} onClose={() => setDialog(null)}
        describe={(e) => { const f = entryAt(tree.files, e.path); return f && <dl className="facts">{f.mtime && <><dt>changed</dt><dd>{day(f.mtime)}</dd></>}{f.size !== undefined && <><dt>size</dt><dd>{size(f.size)}</dd></>}</dl>; }}
        onOpen={(p) => { setDialog(null); open(p); }} />}
      {dialog === "save" && current && <SaveFile what={base(current)} types={TYPES} name={base(current).replace(/(\.\w+)?$/, "-v2$1")} hub={pickHub} list={async () => rows(tree.files)} onClose={() => setDialog(null)}
        onSave={(p) => { setDialog(null); api.save(p, draft ?? doc?.text ?? "").then(() => { reload(); open(p); }, fail); }} />}
      {dialog === "folder" && <TypedPath title="Open folder" onClose={() => setDialog(null)}
        onOpen={(p) => { setDialog(null); switchTo({ name: baseName(p), path: p }, () => api.workIn({ kind: "folder", path: p })); }} />}
      {dialog === "copy" && <TypedPath title="Copy the example to" onClose={() => setDialog(null)} onOpen={(p) => { setDialog(null); copyTo(p); }} />}
      {dialog === "file" && <TypedPath title="Open a local file" what="file" onClose={() => setDialog(null)} onOpen={(p) => { setDialog(null); openAbs(p); }} />}
      {closing && current && <Unsaved name={base(current)} closing={closing.what} onClose={() => setClosing(null)}
        onSave={() => { const then = closing.then; setClosing(null); save(current, draft!).then((ok) => ok && then()); }}
        onDiscard={() => { const then = closing.then; setClosing(null); setDraft(null); then(); }} />}
      {dialog === "help" && <HelpWindow app="Julix" provider={help} commands={commands} onClose={() => setDialog(null)} />}
      {dialog === "about" && <AboutJulix version={info?.version ?? ""} julia={julia} onClose={() => setDialog(null)} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/** The keys the script and a debug run answer that no menu holds: the Shortcuts page lists them with the menus'. */
const EDITOR_KEYS: Command[] = ([
  ["edit.comment", "Comment or uncomment lines", "edit", "Ctrl /"],
  ["kernel.line", "Run line or selection", "kernel", "Shift Enter"],
  ["kernel.bp", "Toggle breakpoint", "kernel", "F9"],
  ["kernel.continue", "Continue (a debug run waits)", "kernel", DEBUG_KEYS.continue],
  ["kernel.pause", "Pause debugging", "kernel", DEBUG_KEYS.pause],
  ["kernel.over", "Step over", "kernel", DEBUG_KEYS.over],
  ["kernel.into", "Step into", "kernel", DEBUG_KEYS.into],
  ["kernel.out", "Step out", "kernel", DEBUG_KEYS.out],
  ["kernel.stop", "Stop debugging", "kernel", DEBUG_KEYS.stop],
] as const).map(([id, label, menu, shortcut]) => ({ id, label, menu, group: "keys", shortcut, run: () => {} }));

/** Settings › Julix: the Julia it runs on and the project it uses. Julix has no Julia settings of its own yet: paperboatd
 *  picks the runtime, and the folder is the project. */
function JuliaSettings({ ws, home, julia }: { ws: Place | null; home?: string; julia?: Run["runtime"] }) {
  const [peek, setPeek] = useState<{ version?: string; error?: string }>();
  useEffect(() => { api.runtimes().then((p) => setPeek({ version: p.julia?.version }), (e) => setPeek({ error: e.message })); }, []);
  const version = julia?.version ?? peek?.version;
  return (
    <SettingsSection title="Julia">
      <SettingRow label="Runtime" hint={peek?.error ? `paperboatd: ${peek.error}` : "Paperboat's Julia runtime: paperboatd starts a session for each folder"}>
        <span className="well">{version ? `Julia ${version}` : peek ? "no Julia runtime" : "asking paperboatd…"}{julia?.backend ? ` · ${julia.backend}` : ""}</span>
      </SettingRow>
      <SettingRow label="Project" hint={`${ws ? "The folder is the Julia project: its Project.toml and Manifest.toml" : "Open a folder: it becomes the Julia project"}. ${PACKAGES}`}>
        {ws && <span className="well path" title={ws.root}><span>{`\u200e${tilde(ws.root, home)}`}</span></span>}
      </SettingRow>
    </SettingsSection>
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
