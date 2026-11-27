// Open example: in Ctrl K (paperboat#72, #75): the server asks `paperboat example list --app julix`, runs `example open <id>
// [--to <the workspace folder>]` and, for the banner's Copy, `example copy <id> --to <folder> --open`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serve } from "../server/main.ts";

const ENTRY = { id: "julix/01-matrices", app: "julix", kind: "julix", name: "01 Matrices", description: "Arrays and linear algebra", path: "/x/julix/01-matrices" };

test("GET /api/examples lists them; open one in place, copy one, or say why not", { skip: process.platform === "win32" }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-examples-")));
  const cli = path.join(tmp, "paperboat"), seen = path.join(tmp, "args"), work = path.join(tmp, "work");
  fs.mkdirSync(work);
  const COPY = { ...ENTRY, path: path.join(work, "01-matrices"), session: "s2" };
  fs.writeFileSync(cli, `#!/bin/sh
echo "$*" >> ${seen}
case "$*" in
  "example list --app julix --json") echo '${JSON.stringify([ENTRY, { name: "no id" }])}' ;;
  "hub list --json") echo '[]' ;;
  "example open julix/01-matrices --json"|"example open julix/01-matrices --to ${work} --json"|"example open julix/01-matrices --to /there --json") echo '${JSON.stringify({ ...ENTRY, session: "s1" })}' ;;
  "example copy julix/01-matrices --to ${work} --open --json") echo '${JSON.stringify(COPY)}' ;;
  "example copy julix/01-matrices --to /there --open --json") echo '{"error": "/there/01-matrices is there already; copy it to another folder"}'; exit 2 ;;
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
    // the banner's Copy: into a whole folder, the CLI's words when it can't
    assert.deepEqual(await call("POST", "/api/examples/copy", { id: "julix/01-matrices", to: work }), { status: 200, json: COPY });
    assert.deepEqual(await call("POST", "/api/examples/copy", { id: "julix/01-matrices", to: "/there" }),
      { status: 502, json: { error: "/there/01-matrices is there already; copy it to another folder" } });
    for (const to of ["--open", "-x", "work", "", 7]) assert.equal((await call("POST", "/api/examples/copy", { id: "julix/01-matrices", to })).status, 400);   // never reaches the CLI
    assert.equal((await call("POST", "/api/examples/copy", { id: "--open", to: work })).status, 502);
    // with a folder open, the example's Copy goes there
    assert.equal((await call("POST", "/api/workspace", { kind: "folder", path: work })).status, 200);
    assert.deepEqual(await call("POST", "/api/examples/open", { id: "julix/01-matrices" }), { status: 200, json: { ...ENTRY, session: "s1" } });
    // an example's window passes its own folder on (its workspace is the examples checkout), or none (null)
    assert.equal((await call("POST", "/api/examples/open", { id: "julix/01-matrices", to: "/there" })).status, 200);
    assert.equal((await call("POST", "/api/examples/open", { id: "julix/01-matrices", to: null })).status, 200);
    assert.equal((await call("POST", "/api/examples/open", { id: "julix/01-matrices", to: "work" })).status, 400);   // never reaches the CLI
    assert.deepEqual(fs.readFileSync(seen, "utf8").trim().split("\n"), [
      "example list --app julix --json", "example open julix/01-matrices --json", "example open julix/nope --json",
      `example copy julix/01-matrices --to ${work} --open --json`, "example copy julix/01-matrices --to /there --open --json",
      "hub list --json", `example open julix/01-matrices --to ${work} --json`,
      "example open julix/01-matrices --to /there --json", "example open julix/01-matrices --json",
    ]);
    // no Paperboat: no examples, and Julix works on
    process.env.PAPERBOAT_BIN = path.join(tmp, "no-such-paperboat");
    assert.deepEqual(await call("GET", "/api/examples"), { status: 200, json: [] });
  } finally {
    server.close();
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
