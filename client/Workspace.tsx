// The Workspace card: the session's variables (filtered by name), and every figure kept, by run. The
// Debug tab waits for the runtime's debug ops (plans/2026-11-24_22-30_julix_v0_1.md).
import { Key, RemoveKey, Tabs } from "@paperboatlab/ui";
import { Heatmap, Plot2D } from "@paperboatlab/ui/plot";
import { useEffect, useMemo, useState } from "react";
import { api, type Figure, type Variable } from "./api.ts";
import { FIGURE } from "./figure/Figure.tsx";

export type FigureRef = { run: string; n: number };
const base = (p: string) => { const s = p.replace(/^@examples\//, ""); return s.slice(s.lastIndexOf("/") + 1); };
const time = (iso: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "");

/** What a type is, briefly: `Matrix{Float64}` stays, a long parametric type keeps its head. */
const short = (t: string) => (t.length > 28 ? `${t.slice(0, t.indexOf("{") > 0 ? t.indexOf("{") : 26)}{…}` : t);

export function Workspace({ tab, onTab, variables, figures, shown, onShow, onCopy }: {
  tab: "vars" | "figs"; onTab: (t: "vars" | "figs") => void; variables: Variable[]; figures: Figure[];
  shown: FigureRef | null; onShow: (f: FigureRef) => void; onCopy: (text: string, what: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const vars = useMemo(() => variables.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase())), [variables, filter]);
  const runs = useMemo(() => {
    const m = new Map<string, Figure[]>();
    for (const f of figures) m.set(f.run, [...(m.get(f.run) ?? []), f]);
    return [...m.entries()];
  }, [figures]);
  const [sel, setSel] = useState<string | null>(null);

  return (
    <>
      <div className="wtabs"><Tabs label="Workspace" value={tab} onChange={onTab} tabs={[{ value: "vars", label: "Variables", count: variables.length }, { value: "figs", label: "Figures", count: figures.length }]} /></div>
      {tab === "vars" && (
        <>
          <label className="well vfilt"><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter variables" aria-label="Filter variables" /><em>{vars.length}</em></label>
          <div className="scroll">
            {variables.length === 0 && <p className="none">No variables yet. Run a script (F5) or type in the console; what you define shows here.</p>}
            {vars.map((v) => (
              <button key={v.name} type="button" className={`vrow${sel === v.name ? " on" : ""}`} title={`${v.name}::${v.type}\n${v.summary}\n\nDouble-click copies the name`}
                onClick={() => setSel(v.name)} onDoubleClick={() => onCopy(v.name, "Name")}>
                <span className="vn"><b>{v.name}</b><small>{short(v.type)}{v.size !== undefined && !/^\d/.test(v.summary) ? ` · ${v.size}` : ""}</small></span>
                <span className="vv">{v.summary}</span>
              </button>
            ))}
          </div>
          {sel && vars.find((v) => v.name === sel) && <Inspect v={vars.find((v) => v.name === sel)!} onCopy={onCopy} />}
        </>
      )}
      {tab === "figs" && (
        <div className="scroll">
          {figures.length === 0 && <p className="none">No figures yet. Anything your code shows as SVG or PNG appears here, by run; try the example 03-figures.jl.</p>}
          {runs.map(([run, fs]) => (
            <div key={run}>
              <div className="frun"><b>{base(fs[0].source)}</b>{time(fs[0].time)}<span>{fs.length} {fs.length === 1 ? "figure" : "figures"}</span>
                <RemoveKey label={`Close the figures of this run`} onClick={() => api.removeFigures(run).catch(() => {})} /></div>
              {fs.map((f) => (
                <button key={f.n} type="button" className={`frow${shown?.run === run && shown.n === f.n ? " on" : ""}`} onClick={() => onShow({ run, n: f.n })}>
                  {f.mime === FIGURE ? <span className="fth scene">plot</span> : <span className="fth"><img src={api.figure(f)} alt="" loading="lazy" /></span>}
                  <span><b>Figure {f.n}</b><small>{base(f.source)} · {f.mime === FIGURE ? "JulixPlot" : f.mime === "image/png" ? "PNG" : "SVG"}</small></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

type Values = Awaited<ReturnType<typeof api.values>>;

/** The selected variable: its type and value, and a real vector or matrix drawn (Plot2D, Heatmap). The
 *  numbers come from the session when the variable changes; a scalar or anything else shows its value only. */
function Inspect({ v, onCopy }: { v: Variable; onCopy: (text: string, what: string) => void }) {
  const [vals, setVals] = useState<Values>(null);
  const plottable = /^(Vector|Matrix|Array|StepRange|UnitRange|LinRange|StepRangeLen|AbstractRange)\b/.test(v.type) || /^(Vector|Matrix)\{/.test(v.type);
  useEffect(() => {
    let live = true;
    setVals(null);
    if (plottable) api.values(v.name).then((r) => live && setVals(r), () => {});
    return () => { live = false; };
  }, [v.name, v.type, v.summary, plottable]);
  return (
    <div className="insp">
      <div className="ih"><b>{v.name}</b><small>{v.type}{v.size !== undefined ? ` · length ${v.size}` : ""}</small>
        <Key size="sm" kind="quiet" onClick={() => onCopy(v.summary, "Value")}>Copy value</Key></div>
      {vals?.kind === "vector" && <div className="iplot"><Plot2D series={[{ x: vals.values.map((_, i) => i + 1), y: vals.values, label: v.name }]} axes={{ grid: true, xlabel: { text: "index" } }} /></div>}
      {vals?.kind === "matrix" && <div className="iplot heat"><Heatmap values={vals.rows} /></div>}
      <pre>{v.summary}</pre>
    </div>
  );
}
