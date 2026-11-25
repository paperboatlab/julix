// The Debug tab (the Julix mockup's Workspace card): Start debugging; while a debug run waits, the
// call stack (a frame shows its locals), Watch (expressions read in the frame) and every breakpoint (on or
// off, a condition: Julia code read where it stops, remove). Stepping is the runtime's (paperboat
// docs/runtime.md "Debugging"), its keys the debug dock's over the editor (App); the breakpoints are the page's, per file, sent with each debug run.
import { DEBUG_KEYS, Key, RemoveKey, Spinner, readStored, writeStored } from "@paperboatlab/ui";
import { useEffect, useState } from "react";
import { api, type Breakpoint, type DebugCommand, type Paused, type Variable } from "./api.ts";

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function Debug({ paused, debugging, current, breakpoints, onStart, onCommand, onBreakpoints, onOpen, onError }: {
  paused: Paused | null; debugging: boolean; current: string | null;
  breakpoints: Record<string, Breakpoint[]>; onStart: () => void; onCommand: (c: DebugCommand) => void;
  onBreakpoints: (path: string, list: Breakpoint[]) => void; onOpen: (path: string, line: number) => void; onError: (e: unknown) => void;
}) {
  const [frame, setFrame] = useState<number | null>(null);
  const [locals, setLocals] = useState<Variable[]>([]);
  const [watch, setWatch] = useState<string[]>(() => readStored("julix.watch", isList) ?? []);
  const [values, setValues] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState("");
  useEffect(() => writeStored("julix.watch", watch), [watch]);

  // a new stop shows its innermost frame
  useEffect(() => { setFrame(paused?.frames[0]?.id ?? null); setLocals(paused?.locals ?? []); }, [paused]);
  useEffect(() => {
    if (!paused || frame === null || frame === paused.frames[0]?.id) return;
    api.frameLocals(frame).then((r) => setLocals(r.locals), onError);
  }, [frame, paused, onError]);
  useEffect(() => {
    if (!paused || frame === null) { setValues({}); return; }
    let live = true;
    Promise.all(watch.map((w) => api.evalIn(frame, w).then((r) => r.summary, (e) => `⚠ ${String((e as Error).message ?? e).split("\n")[0]}`)))
      .then((vs) => live && setValues(Object.fromEntries(watch.map((w, i) => [w, vs[i]]))));
    return () => { live = false; };
  }, [watch, frame, paused]);

  const all = Object.entries(breakpoints).flatMap(([path, list]) => list.map((b) => ({ path, b })));
  const change = (path: string, line: number, f: (b: Breakpoint) => Breakpoint | null) =>
    onBreakpoints(path, (breakpoints[path] ?? []).map((b) => (b.line === line ? f(b) : b)).filter((b): b is Breakpoint => b !== null));

  return (
    <div className="scroll dbg">
      {!debugging && (
        <div className="dstart">
          <Key kind="primary" icon="play" disabled={!current} onClick={onStart} shortcut={DEBUG_KEYS.start}>Start debugging</Key>
          <p>{current ? `Runs ${base(current)} and stops at each breakpoint.` : "Open a script to debug it."} Set one in the gutter or with F9; a condition goes below.</p>
        </div>
      )}
      {debugging && !paused && <div className="dstart"><p className="drun"><Spinner size={12} /> running in the debugger</p><Key size="sm" icon="debug-pause" title={`Pause (${DEBUG_KEYS.pause})`} onClick={() => onCommand("pause")}>Pause</Key></div>}
      {paused && (
        <>
          <div className="dhead">Call stack<small>{paused.reason === "breakpoint" ? "at a breakpoint" : paused.reason === "pause" ? "paused" : "stepped"}</small></div>
          {paused.frames.map((f) => (
            <button key={f.id} type="button" className={`drow${frame === f.id ? " on" : ""}`} onClick={() => setFrame(f.id)} onDoubleClick={() => onOpen(paused.source, f.line)}>
              <b>{f.name}</b><small>{base(paused.source)}:{f.line}</small>
            </button>
          ))}
          <div className="dhead">Locals<small>{locals.length}</small></div>
          {locals.length === 0 && <p className="none">None yet in this frame.</p>}
          {locals.map((v) => <div key={v.name} className="drow" title={`${v.name}::${v.type}\n${v.summary}`}><b>{v.name}</b><small>{v.type}</small><span>{v.summary}</span></div>)}
        </>
      )}
      <div className="dhead">Watch<small>{paused ? "in the frame" : "read when stopped"}</small></div>
      {watch.map((w) => (
        <div key={w} className="drow"><b>{w}</b><span>{paused ? values[w] ?? "…" : "not running"}</span>
          <RemoveKey label={`Stop watching ${w}`} onClick={() => setWatch(watch.filter((x) => x !== w))} /></div>
      ))}
      <label className="well dadd"><input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add an expression" aria-label="Add a watch expression"
        onKeyDown={(e) => { if (e.key === "Enter" && adding.trim() && !watch.includes(adding.trim())) { setWatch([...watch, adding.trim()]); setAdding(""); } }} /></label>
      <div className="dhead">Breakpoints<small>{all.length}</small></div>
      {all.length === 0 && <p className="none">None. Click beside a line number, or F9 on the line.</p>}
      {all.map(({ path, b }) => (
        <div key={`${path}:${b.line}`} className={`drow bpr${b.enabled === false ? " off" : ""}`}>
          <input type="checkbox" checked={b.enabled !== false} aria-label={`${base(path)}:${b.line} on`} onChange={(e) => change(path, b.line, (x) => ({ ...x, enabled: e.target.checked }))} />
          <button type="button" className="lnk" onClick={() => onOpen(path, b.line)}>{base(path)}:{b.line}</button>
          <input className="cond" defaultValue={b.condition ?? ""} placeholder="condition" aria-label={`Condition for ${base(path)}:${b.line}`}
            onBlur={(e) => e.target.value !== (b.condition ?? "") && change(path, b.line, (x) => ({ ...x, condition: e.target.value.trim() }))}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          <RemoveKey label={`Remove ${base(path)}:${b.line}`} onClick={() => change(path, b.line, () => null)} />
        </div>
      ))}
    </div>
  );
}
