// End to end against the real paperboatd and a real Julia runtime (podman, or native). Skipped where
// there is no daemon to start: set PAPERBOATD, or have paperboatd on PATH. The first run pulls and
// compiles, so it is slow once.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Control, type Lease } from "../server/control.ts";
import { Examples, scratchFor } from "../server/examples.ts";
import { Folder } from "../server/folder.ts";
import { depsVolume } from "../server/packages.ts";
import { Sessions, type Run } from "../server/session.ts";

const daemon = process.env.PAPERBOATD ?? (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "paperboatd")).find((p) => fs.existsSync(p));
const done = async (r: Run) => { while (r.state !== "done" && r.state !== "failed") await new Promise((z) => setTimeout(z, 50)); return r; };

test("a script runs in a Julia session lease: output, figures, variables, errors at their line", { skip: !daemon && "no paperboatd", timeout: 600_000 }, async () => {
  const folder = new Folder(fs.mkdtempSync(path.join(os.tmpdir(), "julix-e2e-")));
  fs.mkdirSync(path.join(folder.root, "sub"));
  fs.writeFileSync(path.join(folder.root, "sub", "data.txt"), "42\n");
  const events: Record<string, unknown>[] = [];
  const s = new Sessions(folder, new Control(), (e) => events.push(e));
  try {
    // a file runs in its folder; println streams; the last value is the result
    const a = await done(s.run("file", "sub/a.jl", 'println(read("data.txt", String) |> strip, " ", basename(pwd()))\nx = 6 * 7'));
    assert.equal(a.state, "done", JSON.stringify(a.outputs));
    assert.deepEqual(a.outputs, [{ type: "stream", name: "stdout", text: "42 sub\n" }, { type: "result", data: { "text/plain": "42" } }]);
    assert.equal(a.runtime?.name, "julia");

    // @__DIR__, @__FILE__ and a relative include are the file's own, in a subfolder, even after its code cd's (#46):
    // run whole, a selection and a line of it; the console is a REPL in the folder's root
    fs.writeFileSync(path.join(folder.root, "sub", "helper.jl"), "helped = basename(@__DIR__)\n");
    const here = 'println(realpath(@__DIR__) == realpath(joinpath(ENV["PAPERBOAT_PROJECT"], "sub")), " ", basename(@__FILE__), " ", include("helper.jl"))';
    for (const [kind, line] of [["file", 1], ["cell", 3], ["line", 7]] as const) {
      const r = await done(s.run(kind, "sub/b.jl", `cd(ENV["PAPERBOAT_PROJECT"]); ${here}`, line));
      assert.deepEqual(r.outputs, [{ type: "stream", name: "stdout", text: "true b.jl sub\n" }], `${kind}: ${JSON.stringify(r.outputs)}`);
    }
    const k = await done(s.run("console", "console", 'println(@__DIR__() == pwd() == realpath(ENV["PAPERBOAT_PROJECT"]), " ", include("sub/helper.jl"))'));
    assert.deepEqual(k.outputs, [{ type: "stream", name: "stdout", text: "true sub\n" }], JSON.stringify(k.outputs));

    // what Simplicial takes (Julix's shared variables): numbers, booleans, text, matrices by rows (a vector a
    // column), a big array with a note; names a station variable can't have and other values left out
    const sv = await done(s.run("console", "console", 'k = 2.5; flag = true; label = "cart"; A = [1 2; 3 4]; v = [1.5, 2.5]; big = zeros(70, 70); θ = 1; f(x) = x'));
    assert.equal(sv.state, "done", JSON.stringify(sv.outputs));
    const shared = Object.fromEntries((await s.shared()).map((x) => [x.name, x]));
    assert.deepEqual(shared.k, { name: "k", type: "number", value: 2.5 });
    assert.deepEqual(shared.flag, { name: "flag", type: "boolean", value: true });
    assert.deepEqual(shared.label, { name: "label", type: "text", value: "cart" });
    assert.deepEqual(shared.A, { name: "A", type: "matrix", value: "1.0 2.0; 3.0 4.0" });
    assert.deepEqual(shared.v, { name: "v", type: "matrix", value: "1.5; 2.5" });
    assert.match(shared.big.note ?? "", /too large to share live \(4900 values/);
    assert.equal(shared.θ, undefined);
    assert.equal(shared.f, undefined);

    // a figure script run whole (test/figures.jl): its two display() calls are figures (its last value, a loop, is nothing)
    const b = await done(s.run("file", "figures.jl", fs.readFileSync(new URL("figures.jl", import.meta.url), "utf8")));
    assert.equal(b.state, "done", JSON.stringify(b.outputs));
    assert.deepEqual(b.outputs.filter((o) => o.type === "figure").map((o) => (o as { n: number }).n), [1, 2]);
    assert.match(fs.readFileSync(s.figureFile(b.id, 1), "utf8"), /^<svg/);
    assert.deepEqual(s.figures().filter((f) => f.run === b.id).map((f) => f.mime), ["image/svg+xml", "image/svg+xml"]);

    // a value that shows itself as the Paperboat figure MIME (as JulixPlot's Figure does) is kept as its JSON,
    // with no image rendered beside it (needs the runtime that passes the MIME: paperboat 3d6ed80)
    const fig = await done(s.run("console", "console", `struct PBFig end
Base.show(io::IO, ::MIME"application/vnd.paperboat.figure+json", ::PBFig) = print(io, "{\\"scene\\":{\\"id\\":\\"f\\"},\\"buffers\\":\\"\\"}")
Base.show(io::IO, ::MIME"image/svg+xml", ::PBFig) = error("rendered")
PBFig()`));
    assert.equal(fig.state, "done", JSON.stringify(fig.outputs));
    assert.deepEqual(fig.outputs, [{ type: "figure", n: 1, mime: "application/vnd.paperboat.figure+json" }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(s.figureFile(fig.id, 1), "utf8")), { scene: { id: "f" }, buffers: "" });

    // variables arrive after each run
    assert.ok(s.variables.some((v) => v.name === "x" && v.summary === "42"), JSON.stringify(s.variables));
    assert.ok(s.variables.some((v) => v.name === "K" && v.type === "Float64"), JSON.stringify(s.variables));
    assert.ok(events.some((e) => e.type === "variables"));

    // a cell from line 5 fails at line 6 of its file, as the traceback says
    const c = await done(s.run("cell", "sub/a.jl", "## broken\nerror(\"boom\")", 5));
    assert.equal(c.state, "failed");
    const err = c.outputs.at(-1) as { type: "error"; error: { message: string; traceback?: string } };
    assert.match(err.error.message, /boom/);
    assert.match(err.error.traceback ?? "", /sub\/a\.jl:6/);

    // the editor's questions pass through as the runtime answers them: completion (\pi Tab is π), lint
    assert.ok(((await s.ask("complete", { code: "\\pi", pos: 3 })) as { matches: string[] }).matches.includes("π"));
    const lint = (await s.ask("lint", { code: "x = (1, 2" })) as { problems: { severity: string }[] };
    assert.ok(lint.problems.some((p) => p.severity === "error"), JSON.stringify(lint));

    // a variable's numbers for the Workspace plot, without touching `ans`
    await done(s.run("console", "console", "M = [1.0 2; 3 4]; ans_before = 7"));
    assert.deepEqual(await s.values("M"), { kind: "matrix", rows: [[1, 2], [3, 4]] });
    assert.deepEqual(await s.values("h").then((v) => v && v.kind === "vector" && v.values.length), 200);
    assert.deepEqual(await s.values("K"), { kind: "scalar", value: 4.97 });
    assert.equal(await s.values("nope"), null);   // only a name the session listed

    // the variable editor sets the same name, keeping its element type
    await s.setValues("M", [[1, 2], [3, 40]]);
    assert.deepEqual(await s.values("M"), { kind: "matrix", rows: [[1, 2], [3, 40]] });
    await done(s.run("console", "console", "Mi = [1 2; 3 4];"));
    await s.setValues("Mi", [[5, 6], [7, 8]]);
    assert.equal(s.variables.find((v) => v.name === "Mi")?.type, "Matrix{Int64}");
    await assert.rejects(s.setValues("nope", 1));

    // Help: names the session reaches, and a docstring as HTML
    assert.ok((await s.helpItems("argmin")).some((i) => i.id === "Base.argmin" && i.kind === "function"));
    assert.match(await s.helpPage("Base.argmin"), /<pre><code>argmin/);
  } finally {
    s.close();
  }
});

test("a fresh deps volume gets JulixPlot before the first session: added to a new folder, a Manifest that pins it instantiated", { skip: !daemon && "no paperboatd", timeout: 1_200_000 }, async () => {
  const using = 'using JulixPlot; print(pathof(JulixPlot))';
  // a new folder: JulixPlot is added (its Project.toml and Manifest.toml written)
  const a = new Folder(fs.mkdtempSync(path.join(os.tmpdir(), "julix-e2e-new-")));
  const control = new Control();
  const sa = new Sessions(a, control, () => {});
  const ra = await done(sa.run("console", "console", using));
  sa.close();
  assert.equal(ra.state, "done", JSON.stringify(ra.outputs));
  // the same Project and Manifest as an example opened in place (read-only, in a paperboat-examples checkout): its
  // deps volume is a fresh one, which gets the Manifest's packages without the example being written
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-e2e-example-")));
  const root = path.join(tmp, "paperboat-examples"), ex = path.join(root, "julix", "03-plot");
  fs.mkdirSync(ex, { recursive: true });
  fs.writeFileSync(path.join(ex, "example.toml"), 'kind = "julix"\napp = "julix"\nname = "03 Plot"\n');
  for (const f of ["Project.toml", "Manifest.toml"]) fs.copyFileSync(path.join(a.root, f), path.join(ex, f));
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, encoding: "utf8" });
  g("init", "-q"); g("add", "."); g("commit", "-qm", "examples");
  const b = new Folder(ex, { locked: (p) => p === root || p.startsWith(root + path.sep), scratch: scratchFor });
  assert.equal(b.readOnly, true);
  const manifest = fs.readFileSync(path.join(b.root, "Manifest.toml"), "utf8");
  fs.chmodSync(b.root, 0o555);
  const events: Record<string, unknown>[] = [];
  const control2 = new Control();
  assert.equal(await depsVolume(control2, b.root), null);
  const sb = new Sessions(b, control2, (e) => events.push(e));
  try {
    const rb = await done(sb.run("console", "console", using));
    assert.equal(rb.state, "done", JSON.stringify(rb.outputs));
    assert.match(JSON.stringify(rb.outputs), /\/work\/deps\/packages\/JulixPlot\//);
    assert.ok(events.some((e) => e.type === "session" && /from the Manifest/.test(String(e.detail))), "the start says it installs");
    assert.equal(fs.readFileSync(path.join(b.root, "Manifest.toml"), "utf8"), manifest);
    assert.deepEqual(fs.readdirSync(b.root).sort(), ["Manifest.toml", "Project.toml", "example.toml"]);
    assert.equal(g("status", "--porcelain", "--ignored"), "");
  } finally {
    sb.close();
    fs.chmodSync(b.root, 0o755);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("an example run in place leaves its checkout byte for byte as git has it (paperboat#75)", { skip: !daemon && "no paperboatd", timeout: 600_000 }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-e2e-ex-")));
  const root = path.join(tmp, "paperboat-examples"), ex = path.join(root, "julix", "01-out");
  fs.mkdirSync(path.join(ex, "sub"), { recursive: true });
  fs.writeFileSync(path.join(ex, "example.toml"), 'kind = "julix"\napp = "julix"\nname = "01 Out"\n');
  fs.writeFileSync(path.join(ex, "Project.toml"), "[deps]\n");
  fs.writeFileSync(path.join(ex, "sub", "data.txt"), "42\n");
  // what the examples do: read beside themselves, write out/, show a figure
  fs.writeFileSync(path.join(ex, "sub", "main.jl"), `n = parse(Int, strip(read("data.txt", String)))
mkpath("out"); write("out/results.toml", "n = $n\\n"); write("beside.txt", "x")
struct Pic end
Base.show(io::IO, ::MIME"image/svg+xml", ::Pic) = print(io, "<svg xmlns='http://www.w3.org/2000/svg'/>")
display(Pic())
println(n, " ", read("out/results.toml", String) |> strip, " ", startswith(pwd(), ENV["PAPERBOAT_PROJECT"]))
`);
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: root, encoding: "utf8" });
  g("init", "-q"); g("add", "."); g("commit", "-qm", "examples");
  const folder = new Folder(ex, { locked: (p) => p === root || p.startsWith(root + path.sep), scratch: scratchFor });
  const events: Record<string, unknown>[] = [];
  const s = new Sessions(folder, new Control(), (e) => events.push(e));
  try {
    assert.equal(folder.readOnly, true);
    const a = await done(s.run("file", "sub/main.jl", fs.readFileSync(path.join(ex, "sub", "main.jl"), "utf8")));
    assert.equal(a.state, "done", JSON.stringify(a.outputs));
    assert.deepEqual(a.outputs.filter((o) => o.type === "stream"), [{ type: "stream", name: "stdout", text: "42 n = 42 false\n" }]);
    assert.deepEqual(a.outputs.filter((o) => o.type === "figure"), [{ type: "figure", n: 1, mime: "image/svg+xml" }]);
    assert.ok(s.figureFile(a.id, 1).startsWith(folder.data) && !folder.data.startsWith(root), folder.data);
    // a cell and the console, in the same scratch copy: what the run wrote is there
    const c = await done(s.run("cell", "sub/main.jl", 'println(read("out/results.toml", String))', 1));
    assert.equal(c.state, "done", JSON.stringify(c.outputs));
    const k = await done(s.run("console", "console", 'isfile("sub/out/results.toml")'));
    assert.deepEqual(k.outputs, [{ type: "result", data: { "text/plain": "true" } }]);
    // @__DIR__ is the file's folder in the scratch copy, where the run wrote out/ (#46)
    const d = await done(s.run("line", "sub/main.jl", '(@__DIR__() == pwd(), isfile(joinpath(@__DIR__, "out", "results.toml")), startswith(@__FILE__, ENV["PAPERBOAT_PROJECT"]))', 2));
    assert.deepEqual(d.outputs, [{ type: "result", data: { "text/plain": "(true, true, false)" } }], JSON.stringify(d.outputs));
    assert.equal(g("status", "--porcelain", "--ignored"), "");   // nothing new, nothing changed, not even an ignored file
    // its Project.toml lists no JulixPlot, and none was added: an example runs with the packages it lists
    assert.ok(!events.some((e) => e.type === "session" && /JulixPlot/.test(String(e.detail))), JSON.stringify(events.filter((e) => e.type === "session")));
  } finally {
    s.close();
    fs.rmSync(folder.data, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("an example's lease is read-only: a write into it by absolute path is refused, its scratch takes writes (paperboat#85)", { skip: !daemon && "no paperboatd", timeout: 600_000 }, async (t) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-e2e-ro-")));
  const root = path.join(tmp, "paperboat-examples"), ex = path.join(root, "julix", "05-ro");
  fs.mkdirSync(path.join(ex, "sub"), { recursive: true });
  fs.writeFileSync(path.join(ex, "example.toml"), 'kind = "julix"\napp = "julix"\nname = "05 Read-only"\n');
  fs.writeFileSync(path.join(ex, "Project.toml"), "[deps]\n");
  fs.writeFileSync(path.join(ex, "sub", "data.txt"), "42\n");
  fs.writeFileSync(path.join(ex, "sub", "main.jl"), 'mkpath("out"); write("out/r.txt", "1"); write(joinpath(tempdir(), "julix-ro.txt"), "1"); println(read("data.txt", String) |> strip)\n');
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: root, encoding: "utf8" });
  g("init", "-q"); g("add", "."); g("commit", "-qm", "examples");
  // as `paperboat example open julix/05-ro` starts the server: $PAPERBOAT_EXAMPLE, on the example's folder
  const known = new Examples(async () => [], { id: "julix/05-ro", folder: ex });
  await known.ready;
  const folder = new Folder(ex, { locked: (p) => known.locked(p), scratch: scratchFor });
  assert.equal(folder.readOnly, true);
  const control = new Control();
  const s = new Sessions(folder, control, () => {});
  try {
    // the script runs, writing beside itself (its scratch copy) and to the temp folder
    const a = await done(s.run("file", "sub/main.jl", fs.readFileSync(path.join(ex, "sub", "main.jl"), "utf8")));
    assert.equal(a.state, "done", JSON.stringify(a.outputs));
    assert.deepEqual(a.outputs, [{ type: "stream", name: "stdout", text: "42\n" }]);
    const lease = (await control.call<Lease[]>("ps")).find((l) => l.owner === `julix:${ex}`);
    assert.ok(lease, "the session's lease");
    if (lease.readonly !== true) { t.skip(`paperboatd ${lease.id}: no read-only projects (v0.2.0-beta.9 or later has them)`); return; }
    t.diagnostic(`backend ${lease.backend}`);
    // the example itself, by its absolute path: the runtime's own path to it, and natively the host's too
    const P = 'ENV["PAPERBOAT_PROJECT"]';
    const writes = [
      `write(joinpath(${P}, "sub", "new.txt"), "x")`,
      `open(io -> print(io, "x"), joinpath(${P}, "sub", "data.txt"), "w")`,   // truncates an existing file
      `open(io -> print(io, "x"), joinpath(${P}, "sub", "data.txt"), "a")`,
      `mkdir(joinpath(${P}, "made"))`,
      `rm(joinpath(${P}, "sub", "data.txt"))`,
      ...(lease.backend === "native" ? [`write(${JSON.stringify(path.join(ex, "host.txt"))}, "x")`] : []),
    ];
    for (const [i, code] of writes.entries()) {
      const kind = (["cell", "file", "console"] as const)[i % 3];
      const r = await done(s.run(kind, kind === "console" ? "console" : "sub/main.jl", code));
      assert.equal(r.state, "failed", `${kind} ${code}: ${JSON.stringify(r.outputs)}`);
      assert.match(JSON.stringify(r.outputs), /is read-only: it is an example; copy it/, `${kind} ${code}`);
    }
    // the scratch copy still takes writes, and what the script wrote is there
    const k = await done(s.run("console", "console", 'write("sub/after.txt", "y"); (read("sub/out/r.txt", String), isfile(joinpath(tempdir(), "julix-ro.txt")))'));
    assert.deepEqual(k.outputs, [{ type: "result", data: { "text/plain": '("1", true)' } }], JSON.stringify(k.outputs));
    assert.equal(fs.readFileSync(path.join(ex, "sub", "data.txt"), "utf8"), "42\n");
    assert.equal(g("status", "--porcelain", "--ignored"), "");   // byte for byte as git has it
  } finally {
    s.close();
    fs.rmSync(folder.data, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("an eager session starts as the folder opens, warmed; a run sent meanwhile waits queued (#43)", { skip: !daemon && "no paperboatd", timeout: 600_000 }, async () => {
  const folder = new Folder(fs.mkdtempSync(path.join(os.tmpdir(), "julix-e2e-warm-")));
  fs.writeFileSync(path.join(folder.root, "Project.toml"), '[deps]\nJulixPlot = "a0581f93-fa5f-40d4-84b8-c56ea884187e"\n');   // listed: no install for this test
  const states: string[] = [];
  const s = new Sessions(folder, new Control(), (e) => { if (e.type === "session") states.push(String(e.state)); }, { eager: true });
  try {
    s.start();
    assert.equal(s.state, "starting");
    const r = s.run("line", "a.jl", "x = 1");
    await new Promise((z) => setTimeout(z, 200));
    assert.equal(r.state, "queued");   // the page says it waits for Julia
    await done(r);
    assert.equal(r.state, "done", JSON.stringify(r.outputs));
    assert.deepEqual(states.filter((x, i) => x !== states[i - 1]).slice(0, 2), ["starting", "running"]);
    assert.deepEqual(s.variables.map((v) => v.name), ["x"]);   // the warm-up leaves nothing in the session
    s.restart();   // Restart starts the next one at once
    assert.equal(s.state, "starting");
  } finally {
    s.close();
  }
});
