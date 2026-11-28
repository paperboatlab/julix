// End to end in a browser: the editor's keys (Standard, Vim, Helix) chosen in Settings › Editor reach every
// Julix window through julix.toml, and in Vim the mode shows, `i` inserts, `:w` saves through Julix's Save and
// Julix's own keys still go first. Needs the built page (npm run build) and a Chrome or Chromium: set CHROME, or
// have one where Linux keeps it. Skipped without either.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium, type Page } from "playwright-core";
import { serve } from "../server/main.ts";

// the browser itself, not a wrapper script that outlives close() (Fedora's /usr/bin/chromium-browser)
const chrome = [process.env.CHROME, "/usr/bin/google-chrome", "/usr/lib64/chromium-browser/chromium-browser", "/usr/lib/chromium/chromium", "/usr/bin/chromium"].find((p) => p && fs.existsSync(p));
const built = fs.existsSync(new URL("../dist/index.html", import.meta.url));
const skip = process.platform !== "linux" ? "Linux only" : !built ? "no dist/ (npm run build)" : !chrome && "no Chrome (set CHROME)";

test("Vim chosen in Settings: every window has it, i inserts, :w saves, Julix's keys go first", { skip, timeout: 120_000 }, async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "julix-keys-")));
  const ws = path.join(tmp, "ws"), conf = path.join(tmp, "config");
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, "a.jl"), "x = 1\n");
  const env = { PAPERBOAT_HOME: process.env.PAPERBOAT_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.PAPERBOAT_HOME = path.join(tmp, "home"); process.env.XDG_CONFIG_HOME = conf;
  const { server, ready } = serve(ws, 0);
  await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ executablePath: chrome });
  try {
    await ready;
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const open = async (): Promise<Page> => {   // a window of its own (no storage shared with the others)
      const page = await (await browser.newContext()).newPage();
      await page.goto(url);
      await page.getByRole("treeitem", { name: /a\.jl/ }).or(page.getByText("a.jl", { exact: true })).first().click();
      await page.locator(".cm-content").waitFor();
      return page;
    };
    const status = (page: Page) => page.locator(".cm-vim-panel").innerText().catch(() => "");

    // Standard to start: no mode; Settings › Editor › Keys: Vim, kept in julix.toml
    const one = await open();
    assert.equal(await one.locator(".cm-vim-panel").count(), 0);
    await one.keyboard.press("Control+Comma");
    await one.getByRole("dialog").getByText("Editor", { exact: true }).click();
    // the kit's dropdown: a well with the choice and a chevron, opening a menu (a bare <select> read as a text field)
    const keys = one.getByRole("dialog").getByRole("button", { name: "Keys", exact: true });
    assert.equal(await keys.innerText(), "Standard");
    await keys.click();
    await one.getByRole("menuitemcheckbox", { name: /^Vim/ }).click();
    assert.equal(await keys.innerText(), "Vim");
    await one.keyboard.press("Escape");
    await one.getByRole("dialog").waitFor({ state: "detached" });
    assert.match(await status(one), /NORMAL/);
    if (process.env.PB_SHOTS) await one.screenshot({ path: path.join(process.env.PB_SHOTS, "julix-vim.png") });
    // the Edit menu has it too (and so Ctrl K): Editor keys, Vim checked
    await one.getByRole("menubar").getByRole("menuitem", { name: "Edit", exact: true }).click();
    assert.equal(await one.getByRole("menuitemcheckbox", { name: "Editor keys: Vim" }).getAttribute("aria-checked"), "true");
    await one.keyboard.press("Escape");
    const file = path.join(conf, "paperboat", "julix.toml");
    await waitFor(() => fs.existsSync(file) && /^keymap = "vim"/m.test(fs.readFileSync(file, "utf8")));

    // another window (another port's page has none of this one's storage) reads it from the file
    const two = await open();
    assert.match(await status(two), /NORMAL/);
    await two.locator(".cm-line").first().click();
    await two.keyboard.press("0");
    await two.keyboard.type("iy");
    assert.match(await status(two), /INSERT/);
    await two.keyboard.press("Escape");
    assert.match(await status(two), /NORMAL/);
    await two.keyboard.type(":w");
    await two.keyboard.press("Enter");
    await waitFor(() => fs.readFileSync(path.join(ws, "a.jl"), "utf8") === "yx = 1\n");

    // Julix's keys go ahead of the mode: Ctrl Enter runs the cell, F1 opens the help, Escape closes it
    // (caught here: the run would start Julia, which this test doesn't need)
    await two.route("**/api/run", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"not in this test"}' }));
    const run = two.waitForRequest((r) => r.url().endsWith("/api/run") && r.method() === "POST");
    await two.keyboard.press("Control+Enter");
    assert.equal(JSON.parse((await run).postData() ?? "{}").kind, "cell");
    await two.keyboard.press("F1");
    await two.getByRole("dialog").waitFor();
    await two.keyboard.press("Escape");
    await two.getByRole("dialog").waitFor({ state: "detached" });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

async function waitFor(ok: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}
