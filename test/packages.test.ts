import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hasJulixPlot, parse, recipe } from "../server/packages.ts";

test("JulixPlot is added when the folder's project doesn't list it", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "julix-"));
  assert.equal(hasJulixPlot(d), false);                                   // no Project.toml
  fs.writeFileSync(path.join(d, "Project.toml"), '[deps]\nOptim = "429524aa-4258-5aef-a3af-852621145aeb"\n');
  assert.equal(hasJulixPlot(d), false);
  fs.appendFileSync(path.join(d, "Project.toml"), 'JulixPlot = "06b7c1eb-d5d3-492b-8c0f-45d07f92670e"\n');
  assert.equal(hasJulixPlot(d), true);
  fs.rmSync(d, { recursive: true });
});

test("JulixPlot comes from its repository, or a local checkout; the log says what's there", () => {
  assert.match(recipe(), /PackageSpec\(url="https:\/\/github.com\/paperboatlab\/JulixPlot.jl"/);
  assert.match(recipe(true), /Pkg.develop\(path=joinpath\(ENV\["PAPERBOAT_PROJECT"\], ".julix", "JulixPlot.jl"\)\)/);
  assert.deepEqual(parse("noise\nPKG Plots 1.40.0\nPKG JulixPlot 0.2.0\nJULIX-DONE\n"), { packages: [{ name: "JulixPlot", version: "0.2.0" }, { name: "Plots", version: "1.40.0" }], done: true });
  assert.equal(parse("ERROR: …").done, false);
});
