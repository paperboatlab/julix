// Open example: in Ctrl K (paperboat#72): the server asks `paperboat example list --app julix` and runs `example open <id>`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serve } from "../server/main.ts";

const ENTRY = { id: "julix/01-matrices", app: "julix", kind: "julix", name: "01 Matrices", description: "Arrays and linear algebra", path: "/x/julix/01-matrices" };

test("GET /api/examples lists them; POST /api/examples/open opens one, or says why not", { skip: process.platform === "win32" }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-examples-")));
  const cli = path.join(tmp, "paperboat"), seen = path.join(tmp, "args");
  fs.writeFileSync(cli, `#!/bin/sh
echo "$*" >> ${seen}
case "$*" in
  "example list --app julix --json") echo '${JSON.stringify([ENTRY, { name: "no id" }])}' ;;
  "example open julix/01-matrices --json") echo '${JSON.stringify({ ...ENTRY, session: "s1" })}' ;;
  *) echo '{"error": "no example; paperboat example list shows them"}'; exit 2 ;;
esac
`, { mode: 0o755 });
  const env = { PAPERBOAT_HOME: process.env.PAPERBOAT_HOME, PAPERBOAT_BIN: process.env.PAPERBOAT_BIN };
  process.env.PAPERBOAT_HOME = path.join(tmp, "home"); process.env.PAPERBOAT_BIN = cli;
  const { server } = serve(null, 0);
  try {
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json() };
    };
    assert.deepEqual(await call("GET", "/api/examples"), { status: 200, json: [ENTRY] });
    assert.deepEqual(await call("POST", "/api/examples/open", { id: "julix/01-matrices" }), { status: 200, json: { ...ENTRY, session: "s1" } });
    assert.deepEqual(await call("POST", "/api/examples/open", { id: "julix/nope" }), { status: 502, json: { error: "no example; paperboat example list shows them" } });
    assert.equal((await call("POST", "/api/examples/open", { id: "--app" })).status, 502);   // never passed on as an option
    assert.deepEqual(fs.readFileSync(seen, "utf8").trim().split("\n"),
      ["example list --app julix --json", "example open julix/01-matrices --json", "example open julix/nope --json"]);
    // no Paperboat: no examples, and Julix works on
    process.env.PAPERBOAT_BIN = path.join(tmp, "no-such-paperboat");
    assert.deepEqual(await call("GET", "/api/examples"), { status: 200, json: [] });
  } finally {
    server.close();
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
