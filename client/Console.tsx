// The console: what every run printed, returned, drew and threw, on the screen (black in both themes),
// and a REPL line into the same session: Enter runs, ↑ ↓ recall, Tab completes (`\pi` Tab is π, as in
// Julia's REPL), Ctrl C interrupts. Hidden, the panel keeps its head (REBRAND "Show / hide panels").
import { Icon, Spinner, readStored, writeStored } from "@paperboatlab/ui";
import { useEffect, useRef, useState } from "react";
import { julia, type Completions } from "@paperboatlab/ui/editor";
import { api, session, type Run } from "./api.ts";
import { ours } from "./traceback.ts";

const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const base = (p: string) => { const s = p.replace(/^@examples\//, ""); return s.slice(s.lastIndexOf("/") + 1); };


function What({ r }: { r: Run }) {
  if (r.kind === "console") return <div>{r.code.split("\n").map((l, i) => <div key={i}><span className="pr">{i ? "       " : "julia> "}</span>{l}</div>)}</div>;
  const where = r.kind === "file" ? base(r.source) : `${base(r.source)}, ${r.kind === "cell" ? "cell at line" : "line"} ${r.line}`;
  return <div className="d">run {where}</div>;
}

export function Console({ runs, running, hidden, onHidden, onFigure, onRun }: {
  runs: Run[]; running: boolean; hidden: boolean; onHidden: (h: boolean) => void;
  onFigure: (run: string, n: number) => void; onRun: (code: string) => void;
}) {
  const [input, setInput] = useState("");
  const [hint, setHint] = useState("");
  const history = useRef<string[]>(readStored("julix.console.history", isList) ?? []);
  const at = useRef(-1);
  const end = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [runs]);

  const submit = () => {
    const code = input.trim();
    if (!code) return;
    history.current = [code, ...history.current.filter((h) => h !== code)].slice(0, 200);
    writeStored("julix.console.history", history.current);
    at.current = -1;
    setInput("");
    setHint("");
    onRun(code);
  };
  const recall = (d: number) => {
    const h = history.current, i = Math.max(-1, Math.min(h.length - 1, at.current + d));
    at.current = i;
    setInput(i < 0 ? "" : h[i]);
  };
  const complete = async () => {
    const pos = field.current?.selectionStart ?? input.length;
    let r: Completions | null;
    try { r = await julia.complete!(input, pos, session); } catch { setHint("completions need the session: run something first"); return; }
    if (!r) { setHint("no completions"); return; }
    // one match, or what every match starts with, goes in; the rest are listed under the line
    const labels = r.options.map((o) => o.label);
    const common = labels.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); });
    const insert = labels.length === 1 ? labels[0] : common;
    if (insert.length > r.to - r.from) setInput(input.slice(0, r.from) + insert + input.slice(r.to));
    setHint(labels.length > 1 ? labels.slice(0, 40).join("  ") + (labels.length > 40 ? `  … ${labels.length - 40} more` : "") : "");
  };

  return (
    <section className={`panel cons${hidden ? " hidden" : ""}`} aria-label="Console">
      <div className="panel-head">
        <b>Console</b>
        <small>{runs.length ? `${runs.length} runs` : "julia"}</small>
        <button type="button" className="hide-key" aria-label={hidden ? "Show the Console" : "Hide the Console"} title={`${hidden ? "Show" : "Hide"} the Console (Ctrl J)`} onClick={() => onHidden(!hidden)}>
          <span className="flip"><Icon name="hide-bottom" /></span>
        </button>
      </div>
      <div className="cbody" inert={hidden || undefined} onClick={() => getSelection()?.isCollapsed && field.current?.focus()}>
        <div className="clines">
          {runs.length === 0 && <div className="d">Julia starts with the first run: F5 runs the open script, or type below.</div>}
          {runs.map((r) => (
            <div key={r.id} className="crun">
              <What r={r} />
              {r.outputs.map((o, i) => {
                if (o.type === "stream") return <pre key={i} className={o.name === "stderr" ? "er" : ""}>{o.text}</pre>;
                if (o.type === "result") return <pre key={i}>{o.data["text/plain"]}</pre>;
                if (o.type === "figure") return <button key={i} type="button" className="fig" onClick={() => onFigure(r.id, o.n)}>→ figure {o.n}</button>;
                return <div key={i}><pre className="er">{o.error.type ? `${o.error.type}: ` : ""}{o.error.message}</pre>{o.error.traceback && <pre className="tb">{ours(o.error.traceback)}</pre>}</div>;
              })}
              {r.state === "queued" && <div className="d">queued</div>}
              {r.state === "running" && <div className="d run"><Spinner size={12} /> running…</div>}
            </div>
          ))}
          <div ref={end} />
        </div>
        {hint && <div className="hint">{hint}</div>}
        <form className="cin" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <span className="pr">julia&gt;</span>
          <input ref={field} value={input} onChange={(e) => { setInput(e.target.value); setHint(""); }} placeholder="an expression · \pi then Tab · ↑ history"
            aria-label="Julia expression" autoComplete="off" spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") { e.preventDefault(); recall(1); }
              else if (e.key === "ArrowDown") { e.preventDefault(); recall(-1); }
              else if (e.key === "Tab") { e.preventDefault(); complete(); }
              else if (e.key === "c" && e.ctrlKey && running && !getSelection()?.toString()) { e.preventDefault(); api.interrupt().catch(() => {}); }
            }} />
          {running && <span className="ac"><Spinner size={12} /> Ctrl C interrupts</span>}
        </form>
      </div>
    </section>
  );
}
