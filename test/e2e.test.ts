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

    // completion in the same session (\pi Tab is π)
    assert.ok((await s.complete("\\pi", 3)).matches.includes("π"));
  } finally {
    s.close();
  }
});
