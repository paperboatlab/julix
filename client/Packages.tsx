// The folder's Julia packages in the kit's package manager (PackageWindow, PackagePanel: "first Julix's
// julia up"). The folder is the Julia project; Julix owns the loading and the actions, the platform's
// recipe: an add lets Julia reach the network for that one step (a short lease; the session itself never
// has the network). The registry is a shelf to start from; any General package adds by its name.
import { PackagePanel, PackageWindow, type RegistryItem } from "@paperboatlab/ui/packages";
import type { useToasts } from "@paperboatlab/ui";
import { useCallback, useEffect, useState } from "react";
import { api, type Package } from "./api.ts";

// ponytail: a shelf, not General's index (the session has no network to search it); add any name by typing it
const SHELF: RegistryItem[] = [
  { name: "JulixPlot", note: "figures you pan, zoom and orbit in Julix", repo: "github.com/paperboatlab/JulixPlot.jl" },
  { name: "Plots", note: "plots through backends (shown as images)" }, { name: "CairoMakie", note: "Makie, drawn with Cairo (shown as images)" },
  { name: "DataFrames", note: "tables" }, { name: "CSV", note: "read and write CSV" }, { name: "Optim", note: "optimisation" },
  { name: "DifferentialEquations", note: "ODEs, SDEs, DAEs" }, { name: "ControlSystems", note: "LTI systems, Bode, step" },
  { name: "Statistics", note: "standard library: already there" }, { name: "LinearAlgebra", note: "standard library: already there" },
];

// an add downloads and precompiles (minutes, at times): a toast that turns into its end, so the window can close meanwhile
export function Packages({ julia, onClose, notify }: { julia?: string; onClose: () => void; notify: ReturnType<typeof useToasts>["show"] }) {
  const [list, setList] = useState<Package[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");
  useEffect(() => { api.packages().then((r) => setList(r.packages), (e) => setError(e.message)); }, []);
  const change = useCallback((op: "add" | "remove", name: string) => {
    setBusy(`${op === "add" ? "adding" : "removing"} ${name}`);
    setError("");
    const id = notify({ title: `${op === "add" ? "Adding" : "Removing"} ${name}`, detail: "Julia's Pkg, in this folder's project", state: "working" });
    api.changePackages(op, name)
      .then((r) => {
        setList(r.packages); setOutput(r.log.split("\n").slice(-12).join("\n"));
        notify({ id, title: `${name} ${op === "add" ? "added" : "removed"}`, detail: op === "add" ? "using it in the session picks it up" : undefined, state: "done" });
      }, (e) => { setError(e.message); notify({ id, title: `Couldn't ${op} ${name}`, detail: e.message.split("\n")[0], state: "failed" }); })   // the window shows the whole log
      .finally(() => setBusy(""));
  }, [notify]);
  return (
    <PackageWindow title="Julia packages" tags={[julia && `julia ${julia}`, "this folder's project"]} onClose={onClose}>
      <PackagePanel busy={busy} error={error} output={output} loading={list === null && !error ? "reading the project" : undefined}
        runtime={{ title: "Julia", tag: julia, hint: "The Julia runtime comes with Paperboat (paperboatd's julia image); its version moves with Paperboat's." }}
        environment={list && {
          title: "environment", path: "Project.toml", tags: ["adding downloads it: the network, for that step only"],
          packages: list.map((p) => ({ name: p.name, version: p.version })), empty: "No packages yet: the standard library is always there.",
          remove: (n) => change("remove", n),
        }}
        registry={{ title: "General", source: "pkg.julialang.org", itemsLabel: "to start with", items: SHELF, add: (n) => change("add", n) }} />
    </PackageWindow>
  );
}
