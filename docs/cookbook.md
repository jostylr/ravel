# Ravel cookbook

These recipes use the installed `ravel` command. In this repository, replace
`ravel` with `npm run ravel --` while developing against the workspace.

## Build one Markdown document

Put named `.ravel` fences and an `out` directive in `guide.md`, then validate
and write only under a dedicated build directory:

```sh
ravel check guide.md
ravel build guide.md --out-dir .ravel/runs/guide
```

The output directory receives the declared files, a machine-readable
`.ravel-manifest.json`, a readable `.manifest.txt`, each output's `.ravelmap`
sidecar, and the aggregate `.ravelmap` bundle.

## Build a multi-document project

Use a canonical `ravel.toml` at the project root:

```toml
version = 1

[build]
out_dir = ".ravel/runs/site"

[[files]]
path = "chapters/intro.md"
mode = "primary"

[[files]]
path = "chapters/library.md"
mode = "primary"
```

Then the project needs no input argument:

```sh
ravel check
ravel build
```

Use `--config path/to/ravel.toml` when the configuration is not in the current
working directory. The configuration root is the trust boundary for its inputs
and managed output; see [filesystem safety](filesystem-safety.md).

## Reuse a library chunk

Give the library document a stable document id and reference its chunk from a
consumer with a fully qualified address:

````markdown
<!-- library.md -->
```javascript {.ravel #escape}
export const escape = (value) => String(value).replaceAll("<", "&lt;");
```

<!-- page.md -->
```javascript {.ravel #main}
_"library::escape.javascript"
console.log(escape("<ravel>"));
```
````

List both documents in the TOML project. Ravel's graph records the dependency,
and the generated sidecar records the reference path through the substitution.

## Make a derived variant

Use `emit` in a pipe or pass to name an intermediate result while keeping its
source relationship:

```ravel
create("bundle:app.js", compose(
  _"main.javascript",
  pass(trim(), emit("trimmed.js")),
  pipe(trim(), emit("indented.js"), indent(2))
))
out("dist/app.js", _"bundle:app.js")
```

`pass` observes the accumulator and leaves it in place. `pipe` replaces the
accumulator with its transformed value. See [Pipes and directives](pipes-and-directives.md)
for the complete grammar and transform rules.

## Inspect a dependency and its source mapping

Use the compact graph views for relationships and provenance queries for a
position in a generated file:

```sh
ravel inspect ravel.toml --chunks
ravel inspect ravel.toml --graph
ravel inspect ravel.toml --provenance dist/app.js --generated-offset 120
ravel inspect ravel.toml --provenance dist/app.js \
  --source-uri chapters/intro.md --source-offset 84
```

The final two commands perform generated-to-source and source-to-generated
queries respectively. Exact results identify a source character range; a
transform that changes text is reported as deliberately coarse rather than
pretending a false one-to-one mapping exists.

## Review and clean managed output

A normal build retains outputs that used to be declared but are now absent. It
lists them as stale in the manifest. Preview removal first:

```sh
ravel refresh .ravel/runs/site --dry-run
ravel refresh .ravel/runs/site
```

For a completely fresh managed build, remove every manifest-listed file before
writing the next result:

```sh
ravel build --clean --dry-run
ravel build --clean
```

Neither command removes arbitrary neighboring files. Add `--backup` before a
clean build to snapshot the existing managed output in a ZIP archive.

## Use Ravel in CI

The minimal CI sequence validates source, runs the repository's checks, and
tests the packed npm artifacts:

```sh
npm ci
npm test
npm run test:bun
npm run validate:schema
npm run test:browser
npm run test:pack
```

An application repository normally needs only `ravel check` and `ravel build`.
Use `--dry-run --json` when a CI step should review the planned output without
writing it.
