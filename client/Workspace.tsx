// The Workspace card: the session's variables (filtered by name), the debugger (Debug.tsx), and every
// figure kept, by run.
import { Key, RemoveKey, Tabs, VariableEditor, VariableList, VariableRow, type ValueGridValue } from "@paperboatlab/ui";
import { Heatmap, Plot2D } from "@paperboatlab/ui/plot";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Figure, type Variable } from "./api.ts";
import { FIGURE } from "./figure/Figure.tsx";

export type FigureRef = { run: string; n: number };
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const time = (iso: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "");

/** What a type is, briefly: `Matrix{Float64}` stays, a long parametric type keeps its head. */
const short = (t: string) => (t.length > 28 ? `${t.slice(0, t.indexOf("{") > 0 ? t.indexOf("{") : 26)}{…}` : t);

export type WorkspaceTab = "vars" | "debug" | "figs";
export function Workspace({ tab, onTab, variables, figures, shown, onShow, onCopy, onError, debug, paused }: {
  tab: WorkspaceTab; onTab: (t: WorkspaceTab) => void; variables: Variable[]; figures: Figure[]; debug: ReactNode; paused: boolean;
  shown: FigureRef | null; onShow: (f: FigureRef) => void; onCopy: (text: string, what: string) => void; onError: (e: unknown) => void;
}) {
  const [filter, setFilter] = useState("");
  const vars = useMemo(() => variables.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase())), [variables, filter]);
  const runs = useMemo(() => {
    const m = new Map<string, Figure[]>();
    for (const f of figures) m.set(f.run, [...(m.get(f.run) ?? []), f]);
    return [...m.entries()];
  }, [figures]);
  const [sel, setSel] = useState<string | null>(null);
  // the variable editor (the kit's): numbers as a table that edits the session's variable; anything else as text
  const [editing, setEditing] = useState<{ v: Variable; value: ValueGridValue | string } | null>(null);
  const edit = (v: Variable) => api.values(v.name).then((r) => setEditing({ v, value: !r ? v.summary : r.kind === "scalar" ? r.value : r.kind === "vector" ? r.values : r.rows }), () => setEditing({ v, value: v.summary }));

  return (
    <>
      <Tabs label="Workspace" value={tab} onChange={onTab} tabs={[{ value: "vars", label: "Variables", count: variables.length }, { value: "debug", label: "Debug", count: paused ? "paused" : undefined }, { value: "figs", label: "Figures", count: figures.length }]} />
      {tab === "debug" && debug}
      {tab === "vars" && (
        <>
          <label className="well vfilt"><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter variables" aria-label="Filter variables" /><em>{vars.length}</em></label>
          <VariableList>
            {variables.length === 0 && <p className="empty-note">No variables yet. Run a script (F5) or type in the console; what you define shows here.</p>}
            {/* a row opens in place to its inspector; a double-click (or the inspector's Open key) opens the editor */}
            {vars.map((v) => (
              <div key={v.name} title={`${v.name}::${v.type}\n${v.summary}\n\nDouble-click opens it`} onDoubleClick={(e) => (e.target as Element).closest(".var-row-head") && edit(v)}>
                <VariableRow name={v.name} type={`${short(v.type)}${v.size !== undefined && !/^\d/.test(v.summary) ? ` · ${v.size}` : ""}`} value={v.summary}
                  open={sel === v.name} onOpen={() => setSel(v.name)}>
                  <Inspect v={v} onCopy={onCopy} onEdit={() => edit(v)} />
                </VariableRow>
              </div>
            ))}
          </VariableList>
        </>
      )}
      {tab === "figs" && (
        <div className="scroll">
          {figures.length === 0 && <p className="empty-note">No figures yet. Anything your code shows as SVG or PNG appears here, by run; try the example 03-figures.jl.</p>}
          {runs.map(([run, fs]) => (
            <div key={run}>
              <div className="frun"><b>{base(fs[0].source)}</b>{time(fs[0].time)}<span>{fs.length} {fs.length === 1 ? "figure" : "figures"}</span>
                <RemoveKey label={`Close the figures of this run`} onClick={() => api.removeFigures(run).catch(() => {})} /></div>
              {fs.map((f) => (
                <button key={f.n} type="button" className={`frow${shown?.run === run && shown.n === f.n ? " on" : ""}`} onClick={() => onShow({ run, n: f.n })}>
                  {f.mime !== FIGURE ? <span className="fth"><img src={api.figure(f)} alt="" loading="lazy" /></span>
                    : f.thumb ? <span className="fth paper"><img src={api.thumb(f)} alt="" loading="lazy" /></span> : <span className="fth scene">plot</span>}
                  <span><b>Figure {f.n}</b><small>{base(f.source)} · {f.mime === FIGURE ? "JulixPlot" : f.mime === "image/png" ? "PNG" : "SVG"}</small></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {editing && <VariableEditor name={editing.v.name} type={editing.v.type} value={editing.value} tags={[editing.v.type, typeof editing.value === "string" ? "read-only" : "edits the session"]}
        onChange={(value) => { setEditing({ ...editing, value }); api.setValues(editing.v.name, value as number | number[] | number[][]).catch(onError); }}
        onClose={() => setEditing(null)} />}
    </>
  );
}

type Values = Awaited<ReturnType<typeof api.values>>;

/** The open variable (inside its kit VariableRow): its value, and a real vector or matrix drawn (Plot2D, Heatmap). The
 *  numbers come from the session when the variable changes; a scalar or anything else shows its value only. */
function Inspect({ v, onCopy, onEdit }: { v: Variable; onCopy: (text: string, what: string) => void; onEdit: () => void }) {
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
      <div className="ih"><Key size="sm" kind="quiet" onClick={onEdit}>Open…</Key><Key size="sm" kind="quiet" onClick={() => onCopy(v.summary, "Value")}>Copy value</Key></div>
      {vals?.kind === "vector" && <div className="iplot"><Plot2D series={[{ x: vals.values.map((_, i) => i + 1), y: vals.values, label: v.name }]} axes={{ grid: true, xlabel: { text: "index" } }} /></div>}
      {vals?.kind === "matrix" && <div className="iplot heat"><Heatmap values={vals.rows} /></div>}
      <pre>{v.summary}</pre>
    </div>
  );
}
