// One figure in the figure pane: a JulixPlot figure (application/vnd.paperboat.figure+json) drawn
// interactively by FigureView; any other display (SVG or PNG from Plots.jl, CairoMakie…) as its image.
import { useEffect, useRef, useState } from "react";
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

/** The figure as drawn, small: its canvases composed where they sit, on the figure's own paper. */
function preview(stage: HTMLElement): string | null {
  const box = stage.getBoundingClientRect(), canvases = [...stage.querySelectorAll("canvas")];
  if (!box.width || !canvases.length) return null;
  const scale = Math.min(1, 216 / box.width), out = document.createElement("canvas");
  out.width = Math.round(box.width * scale); out.height = Math.round(box.height * scale);
  const g = out.getContext("2d")!;
  g.fillStyle = getComputedStyle(stage.querySelector(".pb-paper-light, .pb-paper-dark, [style*=background]") ?? stage).backgroundColor || "#fff";
  g.fillRect(0, 0, out.width, out.height);
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    if (r.width && r.height) g.drawImage(c, (r.left - box.left) * scale, (r.top - box.top) * scale, r.width * scale, r.height * scale);
  }
  return out.toDataURL("image/png").slice("data:image/png;base64,".length);
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
  // once drawn, the figure leaves its preview for the Figures list (ponytail: only figures shown here get one)
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scene || f.thumb) return;
    const t = setTimeout(() => { const png = stage.current && preview(stage.current); if (png) api.saveThumb(f.run, f.n, png).catch(() => {}); }, 1200);
    return () => clearTimeout(t);
  }, [scene, key, f.thumb]);
  // the hooks above run on every render: an image figure and a JulixPlot one share this pane
  if (f.mime !== FIGURE) return <div className="screen"><img src={api.figure(f)} alt={label} /></div>;
  if (error) return <p className="empty-state">This figure couldn't be read: {error}</p>;
  return <div className="figstage" ref={stage}><FigureView figureKey={key} scene={scene} label={label} resetSeq={resetSeq} /></div>;
}
