import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hasJulixPlot, INSTANTIATE, latest, missing, parse, recipe, recorded, slug } from "../server/packages.ts";

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

// paperboat-examples julix/03-julixplot's Manifest, cut down: JulixPlot from its repository, a registry package,
// a standard library and a developed path
const MANIFEST = `julia_version = "1.11.6"
manifest_format = "2.0"

[[deps.Base64]]
uuid = "2a0f44e3-6c83-55bd-87e4-b1978d98bd5f"
version = "1.11.0"

[[deps.JulixPlot]]
deps = ["Base64", "Cairo"]
git-tree-sha1 = "2a978f8e284bb5c24b0e86df522386d3d84087be"
repo-rev = "3a8b7e0b516bf3e956829d61d88f7302b178b4dd"
repo-url = "https://github.com/paperboatlab/JulixPlot.jl"
uuid = "a0581f93-fa5f-40d4-84b8-c56ea884187e"
version = "0.2.0"

[[deps.Cairo]]
git-tree-sha1 = "71aa551c5c33f1a4415867fe06b7844faadb0ae9"
uuid = "159f3aea-2a34-519c-b102-8c37f9878175"
version = "1.1.1"

[[deps.Mine]]
path = "dev/Mine"
uuid = "5a0581f9-fa5f-40d4-84b8-c56ea8841870"
version = "0.1.0"
`;

test("a fresh deps volume lacks what the Manifest records, JulixPlot included: it is instantiated before the first session", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "julix-"));
  fs.writeFileSync(path.join(d, "Project.toml"), '[deps]\nJulixPlot = "a0581f93-fa5f-40d4-84b8-c56ea884187e"\n');
  assert.deepEqual(missing(d, null), []);                                 // no Manifest: nothing recorded
  fs.writeFileSync(path.join(d, "Manifest.toml"), MANIFEST);
  assert.deepEqual(recorded(MANIFEST).map((p) => p.name), ["JulixPlot", "Cairo"]);
  // Pkg's own folder names (Base.version_slug): JulixPlot at that tree is packages/JulixPlot/TXU8j
  assert.equal(slug("a0581f93-fa5f-40d4-84b8-c56ea884187e", "2a978f8e284bb5c24b0e86df522386d3d84087be"), "TXU8j");
  assert.deepEqual(missing(d, null), ["JulixPlot", "Cairo"]);             // no deps volume yet (a fresh install)
  const deps = fs.mkdtempSync(path.join(os.tmpdir(), "julix-deps-"));
  assert.deepEqual(missing(d, deps), ["JulixPlot", "Cairo"]);             // an empty one
  fs.mkdirSync(path.join(deps, "packages", "JulixPlot", "OTHER"), { recursive: true });
  assert.deepEqual(missing(d, deps), ["JulixPlot", "Cairo"]);             // another version isn't this one
  fs.mkdirSync(path.join(deps, "packages", "JulixPlot", "TXU8j"));
  fs.mkdirSync(path.join(deps, "packages", "Cairo", slug("159f3aea-2a34-519c-b102-8c37f9878175", "71aa551c5c33f1a4415867fe06b7844faadb0ae9")), { recursive: true });
  assert.deepEqual(missing(d, deps), []);
  assert.match(INSTANTIATE, /Pkg\.instantiate\(\)/);
  assert.equal(latest("  Installing known registries\n\x1b[32m   Installed\x1b[39m Cairo ─ v1.1.1\nPKG Cairo 1.1.1\nJULIX-DONE\n"), "Installed Cairo ─ v1.1.1");
  fs.rmSync(d, { recursive: true }); fs.rmSync(deps, { recursive: true });
});
