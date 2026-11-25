<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/banner-dark.webp">
    <img src=".github/readme/banner-light.webp" width="324" alt="Paperboat Julix">
  </picture>
</h1>

A Julia workbench: scripts, a console, the session's variables and the figures your code draws, in one
window, with the code run by Paperboat's Julia runtime. Part of [Paperboat](https://github.com/paperboatlab/paperboat).

Julix opens a **folder** of `.jl` scripts. F5 runs a script, Ctrl Enter the cell at the cursor (a cell
starts at a `##` line), Shift Enter a line; the console runs an expression in the same session. What
the code shows as SVG or PNG becomes a figure, kept per run.

**Status:** v0.1, rebuilt on the new platform. The previous version, Squero Studio MX, is archived as
[squero-studio-mx-legacy](https://github.com/paperboatlab/squero-studio-mx-legacy). Its editor, file tree and
plots are `@paperboatlab/ui`'s. Next: JulixPlot.jl (interactive figures on the kit's plots) and shared
variables with Simplicial.

**Docs:** <https://paperboatlab.org/apps/julix/> (sources in [`docs/`](docs/))

**Design:** [ARCHITECTURE.md](ARCHITECTURE.md) · **Look:** [@paperboatlab/ui](https://github.com/paperboatlab/paperboat-ui)
and the rebrand mockup (`agent-docs/rebrand/apps/julix`)

## Layout

```text
server/     the app server (Node 22, TypeScript, no dependencies): the folder, the Julia session, the API
docs/       the manual (reStructuredText)
client/     the page (React, @paperboatlab/ui: editor, files, plots), built into dist/
bin/julix   the command
examples/   read-only examples, shown in every folder
test/       unit tests; e2e.test.ts runs real Julia when paperboatd is there
```

## Build

```sh
npm ci
npm run build        # the page into dist/
npm run typecheck
npm test             # e2e.test.ts too, when paperboatd is on PATH or $PAPERBOATD is set
```

## Run

```sh
bin/julix ~/work/tank-level              # http://127.0.0.1:30473/
bin/julix . --port 30500
```

Running code needs the Paperboat runtime daemon: `paperboatd` on PATH (the `paperboat-cli` package) or
`PAPERBOATD=/path/to/paperboatd`; it starts on demand and pulls the Julia image the first time.
`/?open=<path>` opens a file.

## Licence

GNU General Public License version 3 (see [LICENSE](LICENSE)).
