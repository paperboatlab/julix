// Manage runtimes… (paperboat#69): the server runs `paperboat launcher --page runtimes --runtime julia`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serve } from "../server/main.ts";

test("POST /api/launcher opens the Launcher on Runtimes › julia", { skip: process.platform === "win32" }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-launcher-")));
  const cli = path.join(tmp, "paperboat"), seen = path.join(tmp, "args");
  fs.writeFileSync(cli, `#!/bin/sh\necho "$*" > ${seen}\necho '{}'\n`, { mode: 0o755 });
  const env = { PAPERBOAT_HOME: process.env.PAPERBOAT_HOME, PAPERBOAT_BIN: process.env.PAPERBOAT_BIN };
  process.env.PAPERBOAT_HOME = path.join(tmp, "home"); process.env.PAPERBOAT_BIN = cli;
  const { server } = serve(null, 0);
  try {
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${port}/api/launcher`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200);
    assert.equal(fs.readFileSync(seen, "utf8").trim(), "launcher --page runtimes --runtime julia --json");
  } finally {
    server.close();
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
