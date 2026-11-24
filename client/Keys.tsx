// The bar's two popover keys. The runtimes key (REBRAND "Runtimes key": one key, never a row of pills)
// peeks at the workspace's Julia session. The Panels key (the Julix mockup) is one key for every panel:
// a preview per panel, like the theme picker's, each a toggle; shown filled, hidden dashed.
import { Icon, Key, Spinner, useDismiss } from "@paperboatlab/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Peek } from "./api.ts";

const mb = (b?: number) => (b && b > 0 ? b > 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : `${Math.round(b / (1 << 20))} MB` : "");
const dur = (s?: number) => (s === undefined ? "" : s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

function Pop({ label, keyClass, keyTitle, keyBody, className, onOpen, children }: {
  label: string; keyClass: string; keyTitle: string; keyBody: ReactNode; className: string; onOpen?: () => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null), key = useRef<HTMLButtonElement>(null);
  useDismiss(pop, () => setOpen(false), { enabled: open, triggerRef: key });
  return (
    <span className="popw">
      <button ref={key} type="button" className={`key round sq ${keyClass}`} aria-expanded={open} aria-haspopup="dialog" title={keyTitle}
        onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}>{keyBody}</button>
      {open && <div ref={pop} className={`popover ${className}`} role="dialog" aria-label={label}>{children}</div>}
    </span>
  );
}

export function RuntimesKey({ running, starting, version }: { running: boolean; starting: boolean; version: number }) {
  const [peek, setPeek] = useState<Peek | null>(null);
  const [error, setError] = useState("");
  const [asked, setAsked] = useState(false);   // the daemon is asked once the peek has opened, then on every change
  useEffect(() => { if (asked) api.runtimes().then((p) => { setPeek(p); setError(""); }, (e) => setError(e.message)); }, [asked, version]);
  const act = (f: () => Promise<unknown>) => f().catch((e) => setError(e.message)).then(() => api.runtimes().then(setPeek, () => {}));
  const s = peek?.sessions[0];
  return (
    <Pop label="Runtimes" keyClass={`rtk${running || starting ? " live" : ""}`} keyTitle={`Runtimes: Julia${running ? ", running" : starting ? ", starting" : ""}`}
      keyBody={<><Icon name="a-runtimes" />{peek?.sessions.length ? <b className="badge">{peek.sessions.length}</b> : null}</>} className="rtpop"
      onOpen={() => { setAsked(true); if (asked) api.runtimes().then(setPeek, (e) => setError(e.message)); }}>
            <div className="poph"><b>Runtimes</b><span>this folder · paperboat-runtime/0</span></div>
            {error && <p className="rterr">{error}</p>}
            {!peek && !error && <p className="rterr"><Spinner size={12} /> asking paperboatd…</p>}
            {s && (
              <div className={`rt${s.running ? " run" : ""}`}>
                <span className="rlg">jl</span>
                <div><b>Julia {peek?.julia?.version}</b><small>session · {s.backend} · up {dur(s.uptime_s)}{s.stats ? ` · ${mb(s.stats.memory_bytes)}` : ""}</small>
                  {s.running ? <p className="now"><Spinner size={12} />{base(s.running.source)}{s.running.kind === "console" ? "" : `, line ${s.running.line}`}</p> : <p>idle {dur(s.idle_s)}</p>}</div>
                <div className="acts">
                  {s.running && <Key size="sm" kind="quiet" round icon="debug-pause" label="Interrupt" onClick={() => act(api.interrupt)} />}
                  <Key size="sm" kind="quiet" round icon="debug-restart" label="Restart the session (clears the variables)" onClick={() => act(api.restart)} />
                </div>
              </div>
            )}
            {peek && !s && peek.julia && <div className="rt off"><span className="rlg">jl</span><div><b>Julia {peek.julia.version}</b><small>not started · starts with the first run</small></div><div /></div>}
            {peek && !peek.julia && <p className="rterr">paperboatd has no Julia runtime with a session mode.</p>}
            <div className="pfoot"><span>Packages: <code>import Pkg; Pkg.add(…)</code> in the console.</span></div>
    </Pop>
  );
}

export type Side = "l" | "f" | "b" | "r";
export const PANELS: { side: Side; name: string; keys: string }[] = [
  { side: "l", name: "Files", keys: "Ctrl B" }, { side: "f", name: "Figure", keys: "Ctrl Alt F" },
  { side: "b", name: "Console", keys: "Ctrl J" }, { side: "r", name: "Workspace", keys: "Ctrl Alt B" },
];
const PANES: Record<Side | "e", [number, number, number, number]> = { l: [4, 4, 10, 36], e: [16, 4, 16, 26], f: [34, 4, 12, 26], b: [16, 32, 30, 8], r: [48, 4, 12, 36] };

function Thumb({ me }: { me: Side }) {
  return (
    <svg className="thumb lthumb" viewBox="0 0 64 44" width="64" height="44" aria-hidden="true">
      <rect className="bg" width="64" height="44" />
      {Object.entries(PANES).map(([k, [x, y, w, h]]) => <rect key={k} className={k === me ? "me" : "pn"} x={x} y={y} width={w} height={h} rx="1.5" />)}
    </svg>
  );
}

// ponytail: the layout-panels glyph inline until @paperboatlab/ui regenerates its icons from icons.toml
const PANELS_GLYPH = <svg className="glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="square" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><path d="M5.5 2.5v11M10.5 2.5v11M5.5 10h5" /></svg>;

export function PanelsKey({ hidden, onToggle }: { hidden: Record<Side, boolean>; onToggle: (s: Side) => void }) {
  return (
    <Pop label="Panels" keyClass="" keyTitle="Panels: show or hide" keyBody={PANELS_GLYPH} className="lpop">
          <h3>Panels</h3>
          <div className="theme-choices" role="group" aria-label="Panels">
            {PANELS.map((p) => (
              <button key={p.side} type="button" aria-pressed={!hidden[p.side]} title={`${hidden[p.side] ? "Show" : "Hide"} ${p.name} (${p.keys})`} onClick={() => onToggle(p.side)}>
                <Thumb me={p.side} /><span>{p.name}</span><kbd>{p.keys}</kbd>
              </button>
            ))}
          </div>
          <div className="menu-note">Each panel also hides from the key in its head</div>
    </Pop>
  );
}
