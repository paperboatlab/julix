// The runtimes key (REBRAND "Runtimes key": one key, never a row of pills): a peek at the folder's Julia
// session. (The Panels key beside it is @paperboatlab/ui's PanelsKey.)
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
      <button ref={key} type="button" className={`key round ${keyClass}`} aria-expanded={open} aria-haspopup="dialog" title={keyTitle}
        onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}>{keyBody}</button>
      {open && <div ref={pop} className={`popover ${className}`} role="dialog" aria-label={label}>{children}</div>}
    </span>
  );
}

export function RuntimesKey({ running, starting, version, onPackages }: { running: boolean; starting: boolean; version: number; onPackages: () => void }) {
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
            <div className="pfoot"><span>This folder is the Julia project.</span><Key size="sm" kind="quiet" icon="package" onClick={onPackages}>Packages…</Key></div>
    </Pop>
  );
}
