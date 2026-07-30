# 0.1 contracts and configuration

This reference distinguishes Ravel's implemented 0.1 contracts from planned
work. A value described as a versioned contract may be consumed by tools; other
object shapes and implementation details are not public API.

## Stable versioned surfaces

| Surface | Current contract | Compatibility rule |
| --- | --- | --- |
| Ravel Map | version `1` | Reject any other map version. |
| Markdown profile | documented `markdown+ravel-v1` fenced profile | The documented opt-in and primary modes are stable; undocumented fence behavior is not. |
| TOML run config | `version = 1` | Reject unsupported fields or versions. |
| Output manifest | version `2` | Readers accept legacy version `1` manifests for managed cleanup; writers emit version `2`. |
| Generated provenance map | version `1` | Sidecars and aggregate bundles use UTF-16 ranges; unknown versions must not be interpreted as version 1. |
| CLI results and diagnostics | documented commands, exits, and JSON shapes | Additive fields may appear; consumers should use documented fields. |

Generated provenance maps distinguish exact character correspondence from
coarse transform attribution. See [Generated-output provenance maps](provenance-maps.md)
for the format, derivation chains, query API, and current precision boundary.

## Canonical `ravel.toml`

`ravel.toml` is the conventional project file. From its directory, a plain
`ravel` is equivalent to `ravel build --config ravel.toml`. Other TOML names
remain useful for alternate build paths and must be selected explicitly with
`--config`. The `[build]` table is required only when that configuration is
used with `build`; a no-write `run` configuration may omit it.

```toml
version = 1

[build]
name = "site"                    # optional descriptive name
out_dir = ".ravel/runs/site"     # required, relative to this file
clean = false                     # optional; default false
backup = false                    # false, true, or a relative .zip path

[[files]]
path = "guide.md"                # required, relative to this file
document = "guide"               # optional document override
mode = "primary"                 # opt-in (default) or primary

[[outputs]]
name = "dist/main.js"            # required output-relative path
from = "guide::main.javascript"  # required canonical chunk address

[[live.modules]]
specifier = "@example/csv"       # exact import visible inside live code
from = "csv-parse/browser/esm/sync" # installed package export to bundle

[[live.resources]]
name = "cool.csv"                # exact load("cool.csv") name
path = "data/cool.csv"           # UTF-8 file below the project root
```

Markup entries may select `adapter = "markdown"`, `"markdown-litpro"`,
`"myst"`, `"noweb"`, or `"org"`. Org entries additionally accept
`references = "org-noweb" | "underscore-quote" | "both"`,
`noweb_pipes = true | false`, and
`execution_owner = "org" | "pieceful"`. See [Org and Babel](org.md) for the
ownership boundary. Noweb uses its corresponding reference policies and
`dialect = "noweb" | "noweb-plus"`. MyST entries accept
`execution_owner = "myst" | "pieceful"`; `.myst.md` selects the adapter
without TOML. See [MyST Markdown](myst.md).

All file, import, output, and backup paths are confined to the directory that
contains the TOML file. Ravel rejects escaping paths and symbolic-link
traversal. TOML configs are individual runs and are not merged.

`build.clean = true` behaves like `ravel build --clean`: it removes only files
recorded in the preceding Ravel manifest. `build.backup = true` writes the
default dated archive under `backups/`; a string names a relative `.zip`
archive. A backup is made before Ravel cleans or replaces output, and Ravel
refuses to overwrite an existing archive.

## CLI contract

| Command | Effect |
| --- | --- |
| `ravel check <input>` | Validate and evaluate without writing artifacts. |
| `ravel inspect <input>` | Show the completed program, `--chunks`, `--graph`, `--trace`, or a `--provenance <deliverable>` query. |
| `ravel run <input>` | Execute only `.run` blocks through registered providers and print their exported values without writing artifacts. |
| `ravel build <input>` | Execute `.run` blocks, materialize permitted live-result text, and build declared artifacts. TOML supplies `out_dir`; direct inputs require `--out-dir`. |
| `ravel refresh <output-dir>` | Remove only stale managed outputs retained by a prior build. |

`--dry-run` previews build or refresh effects. `--json` emits machine-readable
command results or diagnostics. `--clean` and `--backup [file.zip]` apply to
builds. Explicit CLI options take priority over the corresponding TOML setting
when both name a value.

Exit status `0` means success, `1` means a source/configuration/validation
error, `2` means command usage is invalid, and `3` means an unexpected host or
filesystem failure.

## Diagnostics

Diagnostics have `code`, `severity`, `message`, and source URI/range fields.
Human output is `path:line:column severity[code]: message`; `--json` writes the
same diagnostic objects to standard error.

| Prefix | Owner | Examples |
| --- | --- | --- |
| `RM` | Ravel Map and Markdown adapters | `RM101` fence syntax, `RM200` map shape, `RM201` unreadable/malformed JSON input |
| `RC` | TOML configuration | `RC101` TOML parsing, `RC102` invalid config field/value, `RC103` unavailable resource |
| `RH` | Node host input handling | `RH101` unsupported input, `RH102` incomplete import directive |
| `RV` | Core graph evaluation | references, cycles, transforms, composition, and derived chunks |
| `RJL` | QuickJS/Wasm JavaScript provider | analysis, runtime limits, worker failure, and module preparation |

Codes describe stable user-visible failure classes. Exact prose may improve as
long as the diagnosis and source location remain equivalent.

## Output manifests

Each successful build writes both `.ravel-manifest.json` and `.manifest.txt` in
the output directory. The JSON manifest is the managed-output record; the text
manifest is for review. Version 2 records the Ravel program version, build time,
current deliverables with byte counts and SHA-256 hashes, and retained stale
entries. The manifest is also the authority for `--clean`, `refresh`, and
backup safety—Ravel never deletes arbitrary neighboring files.

See the [Ravel Map schema guide](ravel-map-schema.md),
[Markdown profile](markdown-fences.md), and [lifecycle guide](../README.md#try-the-current-cli)
for worked examples.
