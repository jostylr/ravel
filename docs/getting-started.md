# Five-minute getting started

This is the installed-package workflow for Ravel 0.1. It uses the `ravel`
binary provided by `@pieceful/ravel`; no repository checkout or source-path
imports are required.

## Install

Use Node.js 22 or newer, then install the CLI in a project:

```sh
npm install --save-dev @pieceful/ravel
```

Confirm the binary is available:

```sh
npx ravel --version
npx ravel --help
```

## Build one Markdown document

Create `greeting.md`:

````markdown
---
ravel:
  document: greeting
---

```javascript {.ravel #message}
const message = "Hello from Ravel";
```

```javascript {.ravel #main}
_"message.javascript"
console.log(message);
```

```ravel
out("dist/greeting.js", _"main.javascript")
```
````

First validate without writing files, then inspect the planned graph and build:

```sh
npx ravel check greeting.md
npx ravel inspect greeting.md --graph
npx ravel build greeting.md --out-dir build
```

The resulting program is `build/dist/greeting.js`. Ravel also writes
`.ravel-manifest.json` and `.manifest.txt` in `build/`; these record the files
that Ravel manages and their producing chunk references.

## Preview and safely rebuild

Use a dry run to see deliverables and stale managed files without changing the
filesystem:

```sh
npx ravel build greeting.md --out-dir build --dry-run --json
```

If a later edit removes an output, Ravel retains that stale file by default.
Use `--clean` to remove only files named by the prior manifest before building
again. Add `--backup` when you want an archive of the current output first:

```sh
npx ravel build greeting.md --out-dir build --backup --clean
```

The unnamed archive is placed under `backups/` at the project root. A named
archive must not already exist.

## Next steps

- Use a TOML file with `[[files]]` and `[[outputs]]` for multi-document runs.
  Name the project file `ravel.toml` to make a plain `ravel` build it. Its
  `[build]` table supplies `out_dir` and may also set `clean = true` and
  `backup = true` (or `backup = "archives/before-clean.zip"`). Command-line
  `--clean` and `--backup` add to or override those settings for one run.
- Use `ravel inspect <input> --chunks`, `--graph`, or `--trace --json` to
  understand a project before building it.
- Read the [Markdown profile](markdown-fences.md), [pipes and directives](pipes-and-directives.md), and [map schema guide](ravel-map-schema.md) for the supported 0.1 syntax and contracts.
