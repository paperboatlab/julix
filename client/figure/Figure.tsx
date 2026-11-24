// One figure in the figure pane: a JulixPlot figure (application/vnd.paperboat.figure+json) drawn
// interactively by FigureView; any other display (SVG or PNG from Plots.jl, CairoMakie…) as its image.
import { useEffect, useState } from "react";
import { api, type Figure as FigureRef } from "../api.ts";
import { FigureView } from "./FigureView.tsx";
import { unpackScene, type FigureScene } from "./scene.ts";

export const FIGURE = "application/vnd.paperboat.figure+json";

/** The figure file's JSON: `{scene, buffers}` (paperboat docs/runtime.md "Figures"). */
export function readFigure(json: { scene?: Record<string, unknown>; buffers?: string }): FigureScene {
  const bin = json.buffers ? atob(json.buffers) : "";
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return unpackScene(json.scene ?? {}, bytes);
}

export function Figure({ f, label, resetSeq }: { f: FigureRef; label: string; resetSeq: number }) {
  const [scene, setScene] = useState<FigureScene | null>(null);
  const [error, setError] = useState("");
  const key = `${f.run}/${f.n}`;
  useEffect(() => {
    if (f.mime !== FIGURE) return;
    let live = true;
    setScene(null);
    setError("");
    fetch(api.figure(f)).then((r) => r.json()).then((j) => live && setScene(readFigure(j)), (e) => live && setError(String(e.message ?? e)));
    return () => { live = false; };
  }, [key, f.mime]);
  if (f.mime !== FIGURE) return <div className="screen"><img src={api.figure(f)} alt={label} /></div>;
  if (error) return <div className="empty"><p>This figure couldn't be read: {error}</p></div>;
  return <div className="figstage"><FigureView figureKey={key} scene={scene} label={label} resetSeq={resetSeq} /></div>;
}
