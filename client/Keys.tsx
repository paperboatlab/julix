// The runtimes key (REBRAND "Runtimes key": one key, never a row of pills): the kit's RuntimesKey with the
// folder's Julia session as its row. Julix asks paperboatd once the peek has opened, then on every change.
// (The Panels key beside it is @paperboatlab/ui's PanelsKey.)
import { Key, RuntimesKey, type Runtime } from "@paperboatlab/ui";
import { useEffect, useState } from "react";
import { api, type Peek } from "./api.ts";

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function JuliaRuntimes({ running, starting, version, onPackages }: { running: boolean; starting: boolean; version: number; onPackages: () => void }) {
  const [peek, setPeek] = useState<Peek | null>(null);
  const [error, setError] = useState("");
  const [asked, setAsked] = useState(false);
  const ask = () => api.runtimes().then((p) => { setPeek(p); setError(""); }, (e) => setError(e.message));
  useEffect(() => { if (asked) ask(); }, [asked, version]);
  const act = (f: () => Promise<unknown>) => f().catch((e) => setError(e.message)).then(() => api.runtimes().then(setPeek, () => {}));
  const s = peek?.sessions[0], name = `Julia ${peek?.julia?.version ?? ""}`.trim();
  const rows: Runtime[] | undefined = !peek ? undefined : !peek.julia && !s ? [] : [s
    ? { id: "jl", name, lang: "julia", state: s.running ? "busy" : "idle", via: s.backend, up: s.uptime_s, idle: s.idle_s, memory: s.stats?.memory_bytes,
        now: s.running ? `${base(s.running.source)}${s.running.kind === "console" ? "" : `, line ${s.running.line}`}` : undefined,
        onInterrupt: () => act(api.interrupt), onRestart: () => act(api.restart) }
    : { id: "jl", name, lang: "julia", state: "off" }];
  return (
    <RuntimesKey scope="this folder" runtimes={rows} count={peek?.sessions.length} live={running || starting}
      error={error || (peek && !peek.julia && !s ? "paperboatd has no Julia runtime with a session mode." : undefined)}
      onOpenChange={(o) => { if (!o) return; if (asked) ask(); else setAsked(true); }}
      footer={(close) => <><span>This folder is the Julia project.</span><Key size="sm" kind="quiet" icon="package" onClick={() => { close(); onPackages(); }}>Packages…</Key></>} />
  );
}
