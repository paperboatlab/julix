import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hubs } from "../server/hubs.ts";

/** A fake `paperboat` that prints `out` (and exits with `code`). */
function fake(out: string, code = 0) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "julix-pb-")), "paperboat");
  fs.writeFileSync(f, `#!/bin/sh\ncat <<'EOF'\n${out}\nEOF\nexit ${code}\n`, { mode: 0o755 });
  return f;
}

test("no Malachite, no hub: a missing or failing CLI means no hubs", { skip: process.platform === "win32" }, async () => {
  const was = process.env.PAPERBOAT;
  try {
    process.env.PAPERBOAT = path.join(os.tmpdir(), "no-such-paperboat");
    assert.deepEqual(await hubs(), []);
    process.env.PAPERBOAT = fake("paperboat: hub: not a command", 2);
    assert.deepEqual(await hubs(), []);
    process.env.PAPERBOAT = fake("not json");
    assert.deepEqual(await hubs(), []);
  } finally { if (was === undefined) delete process.env.PAPERBOAT; else process.env.PAPERBOAT = was; }
});

test("hub list --json is read as the kit's hubs", { skip: process.platform === "win32" }, async () => {
  const was = process.env.PAPERBOAT;
  try {
    process.env.PAPERBOAT = fake(JSON.stringify([
      { id: "6f1c", path: "/home/u/hubs/tank-lab", place: "local", name: "tank-lab", shown: "~/hubs/tank-lab" },
      { id: "a93e", path: "/home/u/Dropbox/pump-rig", place: "dropbox", name: "pump-rig", shown: "~/Dropbox/pump-rig", conflicts: ["a (conflicted copy).jl"] },
      { id: "c001", path: "/gone/old", place: "elsewhere", name: "old", shown: "/gone/old", missing: true },
      { name: "no id" },
    ]));
    assert.deepEqual(await hubs(), [
      { id: "6f1c", path: "/home/u/hubs/tank-lab", name: "tank-lab", shown: "~/hubs/tank-lab", place: "local" },
      { id: "a93e", path: "/home/u/Dropbox/pump-rig", name: "pump-rig", shown: "~/Dropbox/pump-rig", place: "dropbox", conflicts: 1 },
      { id: "c001", path: "/gone/old", name: "old", shown: "/gone/old", place: "local", missing: true },
    ]);
  } finally { if (was === undefined) delete process.env.PAPERBOAT; else process.env.PAPERBOAT = was; }
});
