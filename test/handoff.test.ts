// Julix's shared variables reach Simplicial (julix#44), end to end: a real Julia session (paperboatd), a real Simplicial
// station (its scratchpad, from the installed app or SIMPLICIAL_STATION=<paperboat-scratchpad>), Julix's own server
// (serve, sharing as the julix command does). `k = 2.5` defined in Julix shows in the station's live variables, a flow
// whose Number block reads `k` runs with it, and a second Julix with nothing to share (a Start page) doesn't clear it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serve } from "../server/main.ts";
import { Share } from "../server/share.ts";
import { paperboatHome } from "../server/store.ts";

const onPath = (b: string) => (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, b)).find((p) => fs.existsSync(p));
const daemon = process.env.PAPERBOATD ?? onPath("paperboatd");
const station = process.env.SIMPLICIAL_STATION ?? [path.join(paperboatHome(), "apps", "simplicial", "bin", "paperboat-scratchpad")].find((p) => fs.existsSync(p));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Msg = { type: string; [k: string]: unknown };
/** A socket to the station, as Simplicial's page holds one: every message it heard. */
async function page(url: string) {
  const heard: Msg[] = [];
  for (let i = 0; ; i++) {
    const ws = new WebSocket(url);
    const open = await new Promise<boolean>((r) => { ws.onopen = () => r(true); ws.onerror = () => r(false); });
    if (open) {
      ws.onmessage = async (e) => { heard.push(JSON.parse(typeof e.data === "string" ? e.data : await (e.data as Blob).text())); };
      return { ws, heard };
    }
    if (i > 100) throw new Error(`no station at ${url}`);
    await sleep(100);
  }
}
const until = async <T>(what: string, f: () => T | undefined, ms = 60_000): Promise<T> => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = f(); if (v !== undefined) return v; }
  throw new Error(`waited for ${what}`);
};
const remote = (heard: Msg[]) => heard.findLast((m) => m.type === "variables.remote")?.variables as { name: string; value?: unknown }[] | undefined;
const valueOf = (heard: Msg[], name: string) => remote(heard)?.find((v) => v.name === name)?.value;

test("k = 2.5 in Julix shows in Simplicial's live variables, a flow using k runs with it", { skip: (!daemon && "no paperboatd") || (!station && "no Simplicial station (install simplicial, or SIMPLICIAL_STATION)"), timeout: 600_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "julix-handoff-"));
  const port = 52000 + Math.floor(Math.random() * 900), url = `ws://127.0.0.1:${port}`;
  const st = spawn(station!, ["--port", String(port)], { cwd: tmp, stdio: "ignore" });
  const listen = (s: ReturnType<typeof serve>["server"]) => new Promise<number>((r) => s.on("listening", () => r((s.address() as AddressInfo).port)));
  const julix = serve(tmp, 0, undefined, new Share(() => [url]));
  const listening = listen(julix.server);
  let start: ReturnType<typeof serve> | undefined;
  try {
    const jport = await listening;
    const { ws, heard } = await page(url);

    const api = `http://127.0.0.1:${jport}/api`;
    await fetch(`${api}/workspace`);   // answers once the folder is open
    const run = await (await fetch(`${api}/run`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "console", code: "k = 2.5; A = [1 2; 3 4]" }) })).json() as { id?: string; error?: string };
    assert.ok(run.id, JSON.stringify(run));
    // the first run starts Julia (pulls and compiles once): wait for it, saying why if it fails
    for (let state = ""; state !== "done"; await sleep(500)) {
      const r = ((await (await fetch(`${api}/runs`)).json()) as { id: string; state: string; outputs: unknown[] }[]).find((x) => x.id === run.id);
      assert.ok(r, "the run is gone");
      assert.notEqual(r.state, "failed", JSON.stringify(r.outputs));
      state = r.state;
    }
    assert.equal(await until("k from Julix", () => valueOf(heard, "k"), 15_000), 2.5);
    assert.equal(valueOf(heard, "A"), "1.0 2.0; 3.0 4.0");

    // another Julix window opens now (a Start page: nothing to share) and finds the station: k stays
    const share = new Share(() => [url]);
    start = serve(null, 0, undefined, share);
    await until("the other window to connect", () => share.count || undefined, 10_000);
    await sleep(5000);   // the station answers a new socket's messages after its handshake (a second or two)
    assert.equal(valueOf(heard, "k"), 2.5);
    assert.equal(((await (await fetch(`http://127.0.0.1:${port}/variables.remote`)).json()) as { variables: { name: string; value: unknown }[] })
      .variables.find((v) => v.name === "k")?.value, 2.5);

    // a flow whose Number block reads k: what it gives is Julix's 2.5
    const graph = { nodes: [{ id: "c", type: "constant", params: { value: { var: "k" } }, pos: [0, 0] }, { id: "graph", type: "graph", params: {}, pos: [200, 0] }],
      edges: [{ from: ["c", "y"], to: ["graph", "in"] }] };
    const from = heard.length;
    ws.send(JSON.stringify({ type: "graph.run", graph, settings: { duration: 0.1, speed: 0 } }));
    const end = await until("the run to finish", () => heard.slice(from).find((m) => m.type === "run.finished"), 30_000);
    assert.equal(end.status, "done", JSON.stringify(heard.slice(from).filter((m) => m.type === "log")));
    const values = heard.slice(from).flatMap((m) => m.type === "signals" ? m.list as Msg[] : m.type === "signal" ? [m] : []).filter((s) => s.node === "graph").map((s) => s.v);
    assert.ok(values.length > 0, "the Graph got no samples");
    assert.ok(values.every((v) => v === 2.5), JSON.stringify(values));

    // Julix quits: the station drops what it sent
    julix.server.close();
    await until("k to go", () => (remote(heard) && valueOf(heard, "k") === undefined ? true : undefined), 10_000);
    ws.close();
  } finally {
    julix.server.close();
    start?.server.close();
    st.kill();
  }
});
