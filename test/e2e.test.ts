// End to end against the real paperboatd and a real Julia runtime (podman, or native). Skipped where
// there is no daemon to start: set PAPERBOATD, or have paperboatd on PATH. The first run pulls and
// compiles, so it is slow once.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Control } from "../server/control.ts";
import { Folder } from "../server/folder.ts";
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

    // the figures example run whole: its two display() calls are figures (its last value, a loop, is nothing)
    const b = await done(s.run("file", "@examples/03-figures.jl", folder.read("@examples/03-figures.jl")));
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
    assert.equal(await s.values("K"), null);   // a scalar has nothing to plot
    assert.equal(await s.values("nope"), null);   // only a name the session listed
  } finally {
    s.close();
  }
});
