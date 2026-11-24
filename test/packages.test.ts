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

test("an add of JulixPlot comes from its repository, with the network", () => {
  const r = recipe("add", "JulixPlot");
  assert.match(r.code, /PackageSpec\(url="https:\/\/github.com\/paperboatlab\/JulixPlot.jl"/);
  assert.equal(r.network, true);
  assert.deepEqual(parse("PKG JulixPlot 0.3.0\nJULIX-DONE\n"), { packages: [{ name: "JulixPlot", version: "0.3.0" }], done: true });
});
