// Builds the page into dist/: the bundle (esbuild), its fonts, the app mark's frames (AppMark loads them
// beside the bundle) and index.html. The bundle is split: what only a figure needs (three.js for 3D axes, the
// figure code) loads when the first figure shows. Its files are named by their content's hash, so the server
// lets the browser keep them (server/main.ts `file`); index.html names this build's. `--watch` rebuilds on
// change, with plain names.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(path.join(root, "node_modules/@paperboatlab/ui/src/marks/julix"), path.join(dist, "marks/julix"), { recursive: true });
const page = (js: string, css: string) => `<!doctype html>
<html lang="en" data-app="julix">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Julix</title>
<link rel="icon" href="marks/julix/rest.webp">
<link rel="stylesheet" href="${css}">
</head>
<body><div id="root"></div><script type="module" src="${js}"></script></body>
</html>
`;
const options: esbuild.BuildOptions = {
  entryPoints: [path.join(root, "client/main.tsx")],
  bundle: true, format: "esm", splitting: true, outdir: dist, jsx: "automatic", target: "es2022", minify: !watch, metafile: true,
  entryNames: watch ? "[name]" : "[name]-[hash]", chunkNames: "chunks/[name]-[hash]",
  sourcemap: true, loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" }, assetNames: "fonts/[name]-[hash]", logLevel: "warning",
};
/** index.html for a build: its entry's script and stylesheet, as esbuild named them. */
function index(meta: esbuild.Metafile) {
  const [js, out] = Object.entries(meta.outputs).find(([, o]) => o.entryPoint)!;
  const rel = (p: string) => path.relative(dist, path.resolve(root, p)).split(path.sep).join("/");
  fs.writeFileSync(path.join(dist, "index.html"), page(rel(js), rel(out.cssBundle!)));
}
if (watch) {
  fs.writeFileSync(path.join(dist, "index.html"), page("main.js", "main.css"));
  await (await esbuild.context(options)).watch();
  console.log("watching client/ → dist/");
} else index((await esbuild.build(options)).metafile!);
