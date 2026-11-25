import assert from "node:assert/strict";
import { test } from "node:test";
import { applyRun, resultsOf, short } from "../client/results.ts";

test("a run's top-level lines: names, functions, figures; a block's lines are its own", () => {
  const code = [
    "using JulixPlot",
    "t = range(0, 60; length = 300)",
    "K̂, ζ̂ = fit.x",
    "kp★, ki★ = 1, 2",
    "J(p) = sum(abs2, p)",
    "function nm(f, x0)",
    "    n = length(x0)",
    "    for i in 1:n",
    "        n += 1",
    "    end",
    "end",
    "x == 1",
    "fig = Figure(; size = (960, 720))",
    "lines!(ax, t, h; label = \"fit\")",
    "for k in 1:3",
    "    lines!(ax, t, k .* t)",
    "end",
    "C .+= 1   # in place",
  ].join("\n");
  const r = resultsOf(code, 10);
  assert.deepEqual(r.map((x) => [x.line, x.names, x.fn, x.plot]), [
    [11, ["t"], false, false],
    [12, ["K̂", "ζ̂"], false, false],
    [13, ["kp★", "ki★"], false, false],
    [14, [], true, false],
    [15, [], true, false],
    [22, ["fig"], false, true],
    [23, [], false, true],
    [27, ["C"], false, false],
  ]);
});

test("numbers as a chip says them", () => {
  assert.equal(short("0.08686000000000008"), "0.08686");
  assert.equal(short("600.0"), "600");
  assert.equal(short("1.6740984680432243e-12"), "1.67e-12");
  assert.equal(short("Axis(2 plots)"), "Axis(2 plots)");
});

test("a run replaces its lines' results; a failed one clears them; the console has none", () => {
  const run = (id: string, line: number, code: string, state = "done") => ({ id, kind: "cell", source: "a.jl", line, code, state, outputs: [] });
  let m = applyRun({}, run("1", 1, "x = 1\ny = 2\nz = 3"));
  m = applyRun(m, run("2", 2, "y = 5"));
  assert.deepEqual(m["a.jl"].map((e) => [e.r.line, e.run]), [[1, "1"], [3, "1"], [2, "2"]]);
  m = applyRun(m, run("3", 1, "x = oops", "failed"));
  assert.deepEqual(m["a.jl"].map((e) => e.r.line), [3, 2]);
  assert.equal(applyRun(m, { ...run("4", 1, "q = 1"), kind: "console" }), m);
});
