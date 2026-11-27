// Code runs in one Julia session lease for the workspace (paperboat-runtime/0 session mode: a live
// namespace, as a REPL is). Julix runs no code itself: it asks paperboatd for the lease and speaks the
// protocol. A run is a file, a cell, a line or an expression; what it displays as an image becomes a
// figure, kept in `.julix/figures/<run>/` with the run's record beside it. An example (read-only, server/examples.ts)
// is run as it is in a scratch copy, so what its code writes (`out/`) never lands in it; its figures go to scratch too.
import fs from "node:fs";
import path from "node:path";
import { Control, type Lease } from "./control.ts";
import { Folder } from "./folder.ts";
import { Runtime, RuntimeError } from "./runtime.ts";
import { addJulixPlot, depsVolume, hasJulixPlot, instantiate, missing } from "./packages.ts";

export type Kind = "file" | "cell" | "line" | "console";
/** A breakpoint in a file (paperboat docs/runtime.md "Debugging"): a line, and Julia code that must be true. */
export type Breakpoint = { line: number; condition?: string; enabled?: boolean };
/** Where a debug run waits: what the runtime said when it stopped (frames innermost first, the top one's locals). */
export type Paused = { run: string; source: string; reason: string; line: number; frames: { id: number; name: string; line: number }[]; locals: Variable[] };
export type Output =
  | { type: "stream"; name: string; text: string }
  | { type: "result"; data: Record<string, string> }
  | { type: "figure"; n: number; mime: string }
  | { type: "error"; error: { type?: string; message: string; traceback?: string } };
export type Run = {
  id: string; kind: Kind; source: string; line: number; code: string;
  state: "queued" | "running" | "done" | "failed"; started?: string; ms?: number; outputs: Output[];
  runtime?: { name: string; version: string; backend: string };
  debug?: boolean;
};
export type Variable = { name: string; type: string; summary: string; size?: number };
/** A variable as another app takes it (Simplicial's live variables, paperboat/0 `Variable`): a matrix by its rows. */
export type SharedVariable = { name: string; type: "number" | "boolean" | "text" | "matrix"; value?: number | boolean | string; note?: string };
/** Arrays up to this many values are shared whole; a larger one goes with a note instead (as Squero MX did). */
export const LIVE_LIMIT = 4096;
/** A name a station variable can have (Simplicial's `valid_variable_name`; the engine checks the rest). */
const STATION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export type Figure = { run: string; n: number; mime: string; source: string; kind: Kind; time: string; thumb?: boolean };
type Session = { lease: Lease; rt: Runtime; cwd?: string };
export type Values = { kind: "scalar"; value: number } | { kind: "vector"; values: number[] } | { kind: "matrix"; rows: number[][] };
/** A Julia string literal: JSON's escapes, and `$` taken literally. */
const jl = (s: string) => JSON.stringify(s).replaceAll("$", "\\$");

const INTERRUPT_GRACE_MS = 3000;   // after an interrupt with no reply, the session restarts (paperboat docs/runtime.md)
// A JulixPlot figure first (drawn by the page, interactive), then images; one file per figure.
export const FIGURE = "application/vnd.paperboat.figure+json";
const IMAGES = [FIGURE, "image/svg+xml", "image/png"] as const;
const EXT: Record<string, string> = { [FIGURE]: "json", "image/svg+xml": "svg", "image/png": "png" };
const MIME_OF: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const OWNER = (f: Folder) => `julix:${f.root}`;

/** What a new session runs before it says it is ready (#43), so the first run doesn't pay Julia's compile time:
 *  JulixPlot loaded (not bound: the script's own `using` stays the one that brings its names) and a figure drawn
 *  and shown as a run's would be (2D and 3D, the figure MIME the page draws), a value shown, and then the
 *  variables listed (repr of each). Quiet: what it prints and shows goes nowhere. A folder without JulixPlot
 *  warms the rest. */
export const WARMUP = `let id = Base.identify_package("JulixPlot")
  if id !== nothing
    P = Base.require(id)
    Base.invokelatest() do
      fig = P.Figure(; size = (400, 300))
      ax = P.Axis(fig[1, 1]; title = "warm-up", xlabel = "x", ylabel = "y")
      x = range(0, 1; length = 20)
      P.lines!(ax, x, sin.(x); label = "a")
      P.scatter!(ax, x, cos.(x); label = "b")
      P.axislegend(ax)
      ax3 = P.Axis3(fig[1, 2])
      P.surface!(ax3, x[1:5], x[1:5], [sin(a) * cos(b) for a in x[1:5], b in x[1:5]])
      display(fig)
    end
  end
  display([1.0 2.0; 3.0 4.0])
end;`;

/** Code from line `line` (1-based) keeps its line numbers in tracebacks: the lines above become blank. */
export const atLine = (code: string, line: number) => "\n".repeat(Math.max(0, line - 1)) + code;

/** The folder a run's code starts in: its file's folder in the workspace (the lease mounts the workspace). An
 *  example's (`scratch`): the same folder in a copy of it the session makes once, in its own temp folder (a tmpfs
 *  in a container), so what the code writes beside itself stays out of the example and goes with the session. */
export function chdir(dir: string, scratch = false): string {
  const base = scratch
    ? 'get!(ENV, "JULIX_SCRATCH") do; d = joinpath(mktempdir(), basename(ENV["PAPERBOAT_PROJECT"])); cp(ENV["PAPERBOAT_PROJECT"], d); d; end'
    : 'ENV["PAPERBOAT_PROJECT"]';
  return `cd(joinpath(${base}, ${JSON.stringify(dir).replaceAll("$", "\\$")})); nothing`;
}

let seq = 0;
const runId = () => `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-${(++seq).toString().padStart(3, "0")}`;

export class Sessions {
  private session?: Promise<Session>;
  private queue: Promise<unknown> = Promise.resolve();
  running?: Run;
  /** The debug run's stop, while it waits (for a page that opens later than the event). */
  paused?: Paused;
  /** This session's runs, newest last (the console after a page reload); a new session starts empty. */
  runs: Run[] = [];
  variables: Variable[] = [];
  /** Whether Julia is up, for a page that opens later than the event that said so. */
  state: "stopped" | "starting" | "running" = "stopped";
  /** Why the last session didn't start (the page offers Retry); cleared when one starts. */
  error?: string;
  private set(state: Sessions["state"]) { this.state = state; this.emit({ type: "session", state, ...(this.error ? { error: this.error } : {}) }); }

  private folder: Folder;
  private control: Control;
  /** A lease still starting: its runtime ending rejects the wait for its socket (no two-minute freeze). */
  private starting = new Map<string, (e: Error) => void>();
  private emit: (e: Record<string, unknown>) => void;

  /** Whether the session starts as soon as the workspace opens, and again after Restart (#43): the julix command's;
   *  a test's starts with its first run. */
  private eager: boolean;

  constructor(folder: Folder, control: Control, emit: (e: Record<string, unknown>) => void, opts: { eager?: boolean } = {}) {
    this.eager = opts.eager ?? false;
    this.folder = folder;
    this.control = control;
    this.emit = emit;
    control.onEvent = (e) => {
      this.emit({ type: "runtime", event: e });
      if (e.event === "runtime.exited" || e.event === "runtime.failed") this.starting.get(String(e.lease))?.(new Error(`Julia stopped while starting${e.error ? `: ${e.error}` : ""}`));
      if ((e.event === "runtime.exited" || e.event === "runtime.failed") && this.session)
        this.session.then((s) => { if (s.lease.id === e.lease || s.lease.id === (e as any).id) this.drop(); }, () => {});
    };
    control.onClose = () => this.drop();
  }

  private open(): Promise<Session> {
    this.session ??= (async () => {
      this.error = undefined;
      this.set("starting");
      // the folder's packages before the first session (server/packages.ts): JulixPlot added when the project
      // doesn't list it (never to an example's: it runs as it is, with the packages it lists), else what the
      // Manifest records and the deps volume lacks instantiated (an example's too: into the deps volume, the
      // project read-only)
      const root = this.folder.root, step = (detail: string) => this.emit({ type: "session", state: "starting", detail });
      if (!this.folder.readOnly && !hasJulixPlot(root)) { step("Adding JulixPlot"); await addJulixPlot(this.control, this.folder, step); }
      else {
        const lacking = missing(root, await depsVolume(this.control, root));
        if (lacking.length) {
          step(`Installing ${lacking.length === 1 ? lacking[0] : `${lacking.length} packages`} from the Manifest`);
          await instantiate(this.control, this.folder, step);
        }
      }
      // ponytail: one retry; a Julia that ends while starting (seen once, exit 0, no output) usually starts the second time
      const start = async (): Promise<{ lease: Lease; rt: Runtime }> => {
        const lease = await this.control.call<Lease>("acquire", { runtime: "julia", mode: "session", project: this.folder.root, owner: OWNER(this.folder) });
        if (lease.state === "failed") throw new Error(lease.error ?? "Julia failed to start");
        const ended = new Promise<never>((_, reject) => this.starting.set(lease.id, reject));
        try { return { lease, rt: await Promise.race([Runtime.connect(path.join(lease.ipc, "runtime.sock"), 120_000), ended]) }; }
        catch (e) { this.control.call("release", { lease: lease.id }).catch(() => {}); throw e; }
        finally { this.starting.delete(lease.id); }
      };
      const { lease, rt } = await start().catch(() => start());
      rt.onClose = () => this.drop();
      // warmed before it is ready: runs sent meanwhile wait for it (a warm-up that fails is only slower)
      await rt.request("eval", { code: WARMUP, cell: "julix: warm-up" }).catch(() => {});
      await rt.request("variables").catch(() => {});
      this.error = undefined;
      this.set("running");
      return { lease, rt };
    })();
    // a session that didn't start says why, once: Retry (POST /api/session/start) or the next run tries again
    this.session.catch((e) => { this.session = undefined; this.error = String((e as Error)?.message ?? e); this.set("stopped"); });
    return this.session;
  }

  /** Starts the session in the background, warmed up, so it is ready by the time the user runs something
   *  (#43): when the workspace opens, on Retry, and after Restart. Nothing when one runs or is starting. */
  start() { this.open().catch(() => {}); return {}; }

  private drop() {
    const p = this.session;
    this.session = undefined;
    this.variables = [];
    this.runs = [];
    this.paused = undefined;
    this.error = undefined;
    p?.then((s) => { s.rt.close(); this.control.call("release", { lease: s.lease.id }).catch(() => {}); }, () => {});
    this.set("stopped");
    this.emit({ type: "variables", variables: [] });
  }

  figuresDir(run?: string) { return path.join(this.folder.data, "figures", ...(run ? [run] : [])); }

  /** Runs `code` from `source` (a workspace path, or "console") at `line`; runs go one after another. */
  run(kind: Kind, source: string, code: string, line = 1, debug?: { breakpoints: Breakpoint[] }): Run {
    const run: Run = { id: runId(), kind, source, line, code, state: "queued", outputs: [], ...(debug ? { debug: true } : {}) };
    this.runs = [...this.runs.slice(-299), run];
    const send = () => this.emit({ type: "run", run });
    send();
    let figures = 0;
    const figure = (data: Record<string, string>) => {
      const mime = IMAGES.find((m) => data[m]);
      if (!mime) return false;
      const n = ++figures, dir = this.figuresDir(run.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${n}.${EXT[mime]}`), mime === "image/png" ? Buffer.from(data[mime], "base64") : data[mime]);
      run.outputs.push({ type: "figure", n, mime });
      return true;
    };
    this.queue = this.queue.then(async () => {
      let state: "done" | "failed";
      let t0 = Date.now();
      try {
        const s = await this.open();   // while Julia starts the run stays queued: the page says it waits for Julia
        run.state = "running";
        run.started = new Date().toISOString();
        this.running = run;
        send();
        t0 = Date.now();
        const dir = source === "console" ? "" : path.posix.dirname(source) === "." ? "" : path.posix.dirname(source);
        if (s.cwd !== dir) { await s.rt.request("eval", { code: chdir(dir, this.folder.readOnly), cell: "julix: the script's folder" }); s.cwd = dir; }
        run.runtime = { name: s.rt.hello!.runtime.name, version: s.rt.hello!.runtime.version, backend: s.lease.backend };
        const args = { code: atLine(code, line), cell: source, ...(debug ? { debug: true, breakpoints: debug.breakpoints } : {}) };
        const result = await s.rt.request<{ data: Record<string, string> | null; stopped?: boolean }>("eval", args, (note) => {
          if (note.type === "debug") {
            this.paused = note.event === "stopped" ? { run: run.id, source, reason: String(note.reason), line: Number(note.line),
              frames: note.frames as Paused["frames"], locals: note.locals as Variable[] } : undefined;
            this.emit({ type: "debug", paused: this.paused ?? null, run: run.id });
            return;
          }
          if (note.type === "stream") {
            const last = run.outputs.at(-1);
            if (last?.type === "stream" && last.name === note.name) last.text += note.text;
            else run.outputs.push({ type: "stream", name: note.name, text: note.text });
          } else if (note.type === "display" && !figure(note.data)) run.outputs.push({ type: "result", data: note.data });
          send();
        });
        if (result?.data && !figure(result.data)) run.outputs.push({ type: "result", data: result.data });
        if (result?.stopped) run.outputs.push({ type: "stream", name: "stdout", text: "debugging stopped\n" });
        state = "done";
      } catch (e) {
        run.outputs.push({ type: "error", error: e instanceof RuntimeError ? e.error : { type: "julix", message: String((e as Error).message ?? e) } });
        state = "failed";
      }
      run.ms = Date.now() - t0;
      if (debug) { this.paused = undefined; this.emit({ type: "debug", paused: null, run: run.id, ended: true }); }
      await this.refreshVariables();   // before "done", so a finished run never shows the variables before it
      run.state = state;
      if (figures) fs.writeFileSync(path.join(this.figuresDir(run.id), "run.json"), JSON.stringify({ ...run, outputs: undefined }));
      if (this.running === run) this.running = undefined;
      send();
    });
    return run;
  }

  /** Steers the debug run at once (never queued behind it): continue, over, into, out, pause, stop,
   *  breakpoints (a file's, while it runs), locals (of a frame), eval (in a frame). */
  async debug(command: string, args: Record<string, unknown> = {}) {
    if (!this.session) return { running: false };
    const s = await this.session;
    return s.rt.request("debug", { command, ...args });
  }

  /** The session's variables, asked after every run (and sent to the page). */
  async refreshVariables() {
    const s = await this.session?.catch(() => undefined);
    if (!s) return;
    try { this.variables = await s.rt.request<Variable[]>("variables"); } catch { return; }
    this.variables.sort((a, b) => a.name.localeCompare(b.name));
    this.emit({ type: "variables", variables: this.variables });
  }

  /** The editor's and the console's questions to the session (`lint`, `complete`), passed as they are: the
   *  kit's languages speak paperboat-runtime/0 themselves. Null while no session runs: Julia is not started
   *  just to lint, so the editor colours the code and waits for the first run. */
  async ask(op: "lint" | "complete", args: Record<string, unknown>): Promise<unknown> {
    const s = await this.session?.catch(() => undefined);
    return s ? s.rt.request(op, args) : null;
  }

  /** Julix's own question to the session: what `code` prints. Queued with runs; the code ends with `;` and
   *  prints rather than returns, so the user's `ans` stays theirs, and nothing reaches the console.
   *  `start`: start Julia for it (Help does; the Workspace plot only reads a session that is up). */
  private quiet(code: string, label: string, start = false): Promise<string> {
    const out = this.queue.then(async () => {
      const s = start ? await this.open() : await this.session?.catch(() => undefined);
      if (!s) return "";
      let text = "";
      await s.rt.request("eval", { code, cell: `julix: ${label}` }, (n) => { if (n.type === "stream") text += n.text; });
      return text;
    });
    this.queue = out.catch(() => {});
    return out;
  }

  private known(name: string) { return this.variables.some((v) => v.name === name); }   // only a name the session listed
  private ref = (name: string) => `getfield(@__MODULE__, Symbol(${jl(name)}))`;

  /** A variable's numbers (the Workspace plot, the variable editor): a real scalar, vector (up to 100 000)
   *  or matrix (up to 400 × 400); null for anything else. */
  async values(name: string): Promise<Values | null> {
    if (!this.known(name)) return null;
    const text = await this.quiet(`let v = ${this.ref(name)}
  if v isa Real
    print("s", Float64(v))
  elseif v isa AbstractVector{<:Real} && length(v) <= 100_000
    print("v", join(Float64.(v), ","))
  elseif v isa AbstractMatrix{<:Real} && all(<=(400), size(v))
    print("m", size(v, 2), ";", join(Float64.(vec(permutedims(v))), ","))
  end
end;`, "workspace", false).catch(() => "");
    const num = (x: string) => (x === "Inf" ? Infinity : x === "-Inf" ? -Infinity : Number(x));   // NaN reads as NaN
    if (text.startsWith("s")) return { kind: "scalar", value: num(text.slice(1)) };
    if (text.startsWith("v")) return { kind: "vector", values: text.length > 1 ? text.slice(1).split(",").map(num) : [] };
    const m = /^m(\d+);(.*)$/s.exec(text);
    if (!m) return null;
    const cols = Number(m[1]), all = m[2] ? m[2].split(",").map(num) : [], rows: number[][] = [];
    for (let i = 0; i < all.length; i += cols) rows.push(all.slice(i, i + cols));
    return { kind: "matrix", rows };
  }

  /** The session's variables another app can take (Julix's shared variables, read by Simplicial): a real number, a
   *  Bool, a line of text, a real vector or matrix as its rows ("1 2; 3 4", a vector a column) up to LIVE_LIMIT
   *  values, a larger one with no value and a note. One quiet eval; nothing while no session runs. */
  async shared(): Promise<SharedVariable[]> {
    const names = this.variables.map((v) => v.name).filter((n) => STATION_NAME.test(n) && !["t", "pi", "e"].includes(n));
    if (!names.length) return [];
    const text = await this.quiet(`let out = IOBuffer()
  for s in (${names.map((n) => `:${n}`).join(", ")},)
    isdefined(@__MODULE__, s) || continue
    v = getfield(@__MODULE__, s)
    if v isa Bool
      print(out, s, "\tb\t", v, "\n")
    elseif v isa Real && isfinite(v)
      print(out, s, "\tn\t", Float64(v), "\n")
    elseif v isa AbstractString && length(v) <= 500 && !any(c -> c in "\t\n\r", v)
      print(out, s, "\tt\t", v, "\n")
    elseif v isa AbstractVecOrMat{<:Real} && !isempty(v)
      if length(v) > ${LIVE_LIMIT}
        print(out, s, "\tbig\t", join(size(v), "×"), "\t", length(v), "\n")
      elseif all(isfinite, v)
        m = v isa AbstractVector ? reshape(v, :, 1) : v
        print(out, s, "\tm\t", join((join(Float64.(m[i, :]), " ") for i in axes(m, 1)), "; "), "\n")
      end
    end
  end
  print(String(take!(out)))
end;`, "shared variables", false).catch(() => "");
    return parseShared(text);
  }

  /** The variable editor's change: the same name, the new numbers, its element type kept (Int stays Int). */
  async setValues(name: string, value: number | number[] | number[][]): Promise<void> {
    if (!this.known(name)) throw new Error(`${name} isn't a variable of the session`);
    const ints = /^(Int|Vector\{Int|Matrix\{Int|Array\{Int)/.test(this.variables.find((v) => v.name === name)!.type);
    const lit = (x: number) => { if (!Number.isFinite(x)) return x !== x ? "NaN" : x > 0 ? "Inf" : "-Inf"; return ints ? String(Math.round(x)) : String(x).includes(".") || /e/i.test(String(x)) ? String(x) : `${x}.0`; };
    const T = ints ? "Int" : "Float64";
    const code = typeof value === "number" ? lit(value)
      : Array.isArray(value[0]) ? `${T}[${(value as number[][]).map((r) => r.map(lit).join(" ")).join("; ")}]`
      : `${T}[${(value as number[]).map(lit).join(", ")}]`;
    await this.quiet(`Core.eval(@__MODULE__, :(${name} = ${code}));`, "variable editor", false);
    await this.refreshVariables();
  }

  /** Help (F1): names that match in the session and the modules it loaded, and a name's docstring as HTML. */
  async helpItems(query: string): Promise<{ id: string; title: string; kind: string; summary: string }[]> {
    const text = await this.quiet(`let q = lowercase(${jl(query)}), n = 0, mods = unique!([@__MODULE__, Base, Core, values(Base.loaded_modules)...])
  hits = Tuple{Int, String, String, String}[]
  for m in mods, s in names(m)
    t = string(s)
    (occursin(q, lowercase(t)) && isdefined(m, s) && !startswith(t, "#")) || continue
    v = getfield(m, s)
    kind = v isa Module ? "module" : v isa Function ? "function" : v isa Type ? "type" : "value"
    push!(hits, (startswith(lowercase(t), q) ? (length(t) == length(q) ? 0 : 1) : 2, string(nameof(m)), t, kind))
  end
  for (_, m, t, kind) in first(sort!(unique!(hits)), 60)
    println(m, "\\t", t, "\\t", kind)
  end
end;`, "help", true);
    return text.split("\n").filter(Boolean).map((l) => { const [m, t, kind] = l.split("\t"); return { id: `${m}.${t}`, title: t, kind, summary: m }; });
  }

  async helpPage(id: string): Promise<string> {
    const dot = id.lastIndexOf("."), mod = id.slice(0, dot), name = id.slice(dot + 1);
    return this.quiet(`let mods = unique!([@__MODULE__, Base, Core, values(Base.loaded_modules)...]), i = findfirst(m -> string(nameof(m)) == ${jl(mod)}, mods)
  i === nothing || print(sprint(show, MIME"text/html"(), Base.Docs.doc(Base.Docs.Binding(mods[i], Symbol(${jl(name)})))))
end;`, "help", true);
  }

  /** Every figure kept, newest run first. */
  figures(): Figure[] {
    const root = this.figuresDir();
    if (!fs.existsSync(root)) return [];
    const out: Figure[] = [];
    for (const id of fs.readdirSync(root).sort().reverse()) {
      let meta: Run;
      try { meta = JSON.parse(fs.readFileSync(path.join(root, id, "run.json"), "utf8")); } catch { continue; }   // a run still writing, or damaged
      for (const f of fs.readdirSync(path.join(root, id))) {
        const m = /^(\d+)\.(json|svg|png)$/.exec(f);
        if (m) out.push({ run: id, n: Number(m[1]), mime: MIME_OF[m[2]], source: meta.source, kind: meta.kind, time: meta.started ?? "",
          thumb: fs.existsSync(path.join(root, id, `${m[1]}.thumb.png`)) });
      }
    }
    return out.sort((a, b) => (a.run === b.run ? a.n - b.n : a.run < b.run ? 1 : -1));
  }

  figureFile(run: string, n: number, thumb = false): string {
    if (!/^[\w-]+$/.test(run)) throw new Error("bad run");
    if (thumb) { const p = path.join(this.figuresDir(run), `${n}.thumb.png`); if (fs.existsSync(p)) return p; throw new Error("no preview"); }
    for (const ext of ["json", "svg", "png"]) { const p = path.join(this.figuresDir(run), `${n}.${ext}`); if (fs.existsSync(p)) return p; }
    throw new Error("no such figure");
  }

  /** A JulixPlot figure's preview, as the page drew it (the runtime sends a scene, never an image). */
  saveThumb(run: string, n: number, png: string) {
    const bytes = Buffer.from(png, "base64");
    if (!/^[\w-]+$/.test(run) || !Number.isInteger(n) || n < 1) throw new Error("bad figure");
    if (bytes.length > 512 << 10 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("a preview is a small PNG");
    if (!fs.existsSync(path.join(this.figuresDir(run), `${n}.json`))) throw new Error("no such figure");
    fs.writeFileSync(path.join(this.figuresDir(run), `${n}.thumb.png`), bytes);
  }

  removeFigures(run: string) { if (/^[\w-]+$/.test(run)) fs.rmSync(this.figuresDir(run), { recursive: true, force: true }); }

  /** Stops the running code: SIGINT through the daemon; a runtime that doesn't answer soon restarts. */
  async interrupt() {
    const run = this.running;
    if (!this.session || !run) return { interrupted: false };
    const s = await this.session;
    await this.control.call("interrupt", { lease: s.lease.id }).catch(() => s.rt.request("interrupt").catch(() => {}));
    setTimeout(() => { if (this.running === run) this.restart(); }, INTERRUPT_GRACE_MS);
    return { interrupted: true };
  }

  /** A fresh session: the variables are lost; an eager one starts again at once, else the next run starts it.
   *  `again: false` only ends this one (the workspace moved on). */
  restart(again = true) { this.drop(); if (again && this.eager) this.start(); return {}; }

  close() { this.drop(); this.control.close(); }

  /** The runtimes key's peek: this workspace's session with its stats. */
  async peek() {
    const leases = await this.control.call<Lease[]>("ps");
    const mine = leases.filter((l) => l.owner === OWNER(this.folder));
    const sessions = await Promise.all(mine.map(async (l) => ({
      ...l,
      stats: await this.control.call("stats", { lease: l.id }).then((r: any) => r.stats, () => null),
      running: this.running ? { source: this.running.source, kind: this.running.kind, line: this.running.line, since: this.running.started } : null,
    })));
    const list = await this.control.call<{ runtimes: { name: string; version: string; modes: string[] }[] }>("runtimes.list");
    return { sessions, julia: list.runtimes.find((r) => r.name === "julia" && r.modes.includes("session")) ?? null };
  }
}

/** What `shared`'s eval printed: a line per variable, `name<TAB>kind<TAB>value`. */
export function parseShared(text: string): SharedVariable[] {
  const out: SharedVariable[] = [];
  for (const line of text.split("\n")) {
    const [name, kind, value = "", count] = line.split("\t");
    if (!name || !kind) continue;
    if (kind === "b") out.push({ name, type: "boolean", value: value === "true" });
    else if (kind === "n") out.push({ name, type: "number", value: Number(value) });
    else if (kind === "t") out.push({ name, type: "text", value });
    else if (kind === "m") out.push({ name, type: "matrix", value });
    else if (kind === "big") out.push({ name, type: "matrix", note: `${value}: too large to share live (${count} values, limit ${LIVE_LIMIT}); share a slice such as ${name}[1:10, 1:10]` });
  }
  return out;
}
