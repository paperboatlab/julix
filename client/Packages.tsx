// The folder's Julia packages (the folder is the Julia project): the list, add and remove. Adding lets
// Julia reach the network for that one step (the platform runs it in a short lease; the session itself
// never has the network), so the dialog says so before it starts. JulixPlot is one click.
import { Dialog, Key, RemoveKey, Spinner } from "@paperboatlab/ui";
import { useEffect, useState } from "react";
import { api, type Package } from "./api.ts";

export function Packages({ onClose, onDone }: { onClose: () => void; onDone: (what: string) => void }) {
  const [list, setList] = useState<Package[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { api.packages().then((r) => setList(r.packages), (e) => setError(e.message)); }, []);
  const go = (op: "add" | "remove", n: string) => {
    setBusy(`${op === "add" ? "Adding" : "Removing"} ${n}…`);
    setError("");
    api.changePackages(op, n).then((r) => { setList(r.packages); setName(""); onDone(`${n} ${op === "add" ? "added" : "removed"}`); }, (e) => setError(e.message)).finally(() => setBusy(""));
  };
  const has = (n: string) => !!list?.some((p) => p.name === n);
  return (
    <Dialog title="Julia packages" onClose={onClose} actions={<Key onClick={onClose}>Done</Key>}>
      <div className="pkgs">
        <p className="muted">This folder is a Julia project; its packages load with <code>using</code> in the session. Adding one lets
          Julia download it, and what it needs, for that step only.</p>
        {!has("JulixPlot") && <div className="pkg-jp"><b>JulixPlot</b><span className="muted">figures you can pan, zoom and orbit here</span>
          <Key size="sm" kind="primary" disabled={!!busy} onClick={() => go("add", "JulixPlot")}>Add</Key></div>}
        <label className="well ask"><input value={name} onChange={(e) => setName(e.target.value.trim())} placeholder="A package from the General registry: Plots, DataFrames…"
          onKeyDown={(e) => e.key === "Enter" && name && !busy && go("add", name)} aria-label="Package name" disabled={!!busy} />
          <Key size="sm" disabled={!name || !!busy} onClick={() => go("add", name)}>Add</Key></label>
        {busy && <p className="pkg-busy"><Spinner size={12} /> {busy} (Julia's package manager; the first time can take minutes)</p>}
        {error && <pre className="pkg-err">{error}</pre>}
        <div className="pkg-list">
          {list === null && !error && <p className="muted"><Spinner size={12} /> reading the project…</p>}
          {list?.length === 0 && <p className="muted">No packages yet: the standard library is always there.</p>}
          {list?.map((p) => (
            <div key={p.name} className="pkg"><b>{p.name}</b><span className="mono muted">{p.version}</span>
              <RemoveKey label={`Remove ${p.name}`} onClick={() => !busy && go("remove", p.name)} /></div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
