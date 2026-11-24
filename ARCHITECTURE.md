# Architecture

The plan and its decisions: `plans/2026-11-24_22-30_julix_v0_1.md` in the workspace. This page is the
map.

## 1. Overview

Julix is an app server and a page, built like Malachite. The server owns the folder and speaks two
protocols of the platform: `paperboat-control/0` to `paperboatd` for the session lease, and
`paperboat-runtime/0` to the Julia runtime the lease starts. The page is a client of the server only.

```mermaid
flowchart LR
  P[page: React + @paperboatlab/ui] -- "HTTP JSON + SSE (127.0.0.1)" --> S
  subgraph S[julix server]
    F[Folder: files, examples, trash] --- X[Sessions: one Julia lease, runs, figures, variables]
    X --> C[Control client]
    X --> R[Runtime client]
  end
  C -- paperboat-control/0 --> D[paperboatd]
  R -- paperboat-runtime/0 --> K[(julia session)]
  D --> K
  F --- W[(the folder)]
```

## 2. Codemap

- `server/folder.ts`: `Folder`: every path through `resolve` (inside the folder, symlinks too; the
  examples under `@examples/`, read-only), the tree, read/write (atomic), create (a free name), rename,
  copy in, trash (`.julix/trash`).
- `server/session.ts`: `Sessions`: one Julia session lease for the folder, acquired on the first run.
  A run is a file, a cell, a line or a console expression; runs queue, run in their file's folder, keep
  their line numbers (`atLine`), stream output, and turn every SVG or PNG display into a figure in
  `.julix/figures/<run>/` (a JulixPlot figure as `<n>.json`: the Paperboat figure MIME, its scene and
  buffers). Variables are asked after each run, before the run reports done. Interrupt
  goes through the daemon (SIGINT); no answer within 3 s restarts the session.
- `server/packages.ts`: the folder's Julia packages the platform's way (the CLI's recipe): an exec lease
  changes the project, with the network for an add only; `JULIXPLOT=<checkout>` develops a local JulixPlot.
- `server/control.ts`, `server/runtime.ts`: the protocol clients, copied from Malachite.
- `server/main.ts`: the HTTP server: the page from `dist/`, the JSON API, Server-Sent Events. The editor's
  `lint` and `complete` pass through `/api/session` as the runtime answers them; `/api/values` prints a
  variable's numbers for the plot (queued with runs, `ans` untouched).
- `client/`: `App.tsx` (the window: bar, cards, dialogs, Ctrl K, the file menus), `Code.tsx` (the kit's
  Editor with Julix's cells and run keys), `cells.ts` (where cells start and end), `Console.tsx` (runs and
  the REPL line), `traceback.ts`, `Workspace.tsx` (Variables with the selected one plotted, Figures),
  `Keys.tsx` (the runtimes key), `Packages.tsx` (the packages dialog), `api.ts` (with the session the
  editor lints and completes through).
- `client/figure/`: `Figure.tsx` (a figure file: a JulixPlot scene to FigureView, else its image),
  `FigureView.tsx` and `scene.ts` (from legacy MX: the figure's grid; 2D axes on the kit's `Plot2D`,
  colour bars, legends, TeX labels; 3D axes on the stage).
- `client/stage/`: the 3D stage (three.js, orbit, view cube, axes; paperboat-shared-legacy's station
  view). ponytail: here until it joins `@paperboatlab/ui` beside Simplicial's stage.
- From `@paperboatlab/ui`: the editor, Julia's grammar, lint and completion (`/editor`), the file tree
  (`/files`), `Plot2D` and `Heatmap` (`/plot`), the Panels key, and the rest of the kit.

## 3. Invariants

1. **The files are the record.** `.julix/` (figures, trash) can be deleted; nothing a script needs
   lives only there or in the server's memory.
2. **Julix runs no code.** Code runs in the runtime leased from `paperboatd`; the server only speaks the
   protocols (paperboat ARCHITECTURE invariant 9).
3. **Paths stay in the folder.** Every path from the page goes through `Folder.resolve`; the examples
   are read-only.
4. **An error points at the user's line.** Code run from line n is sent with n − 1 blank lines before
   it and labelled with its file, so Julia's traceback names the file and line in the editor.
5. **A figure is data or an image, never a page.** A JulixPlot figure is JSON the page draws; any other
   figure is served with a CSP that allows no script, and shown as an image.
6. **Local only.** The server listens on 127.0.0.1 and answers only its own Host and Origin.
