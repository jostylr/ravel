# Filesystem safety and trust boundaries

Ravel's portable graph evaluator is static: it parses documents, resolves
chunks, applies its documented string transforms, and plans outputs. It does
not execute shell commands, network requests, or document code. The only
document code Ravel runs is explicitly marked `.run` blocks, and only through
`ravel run` and `ravel build`, inside the isolated QuickJS runtime described in
[live execution](live-execution.md), which has no filesystem, network, or
process access. Filesystem access is supplied only by
`@pieceful/ravel-host-node` and the CLI.

The one exception is configuration, not documents: modules listed under
`[[transforms]]` in `ravel.toml` are imported and run as ordinary Node code
with your privileges whenever the project is checked or built (see
[transforms and collections](transforms-and-collections.md)). A document cannot
add one. Ravel's built-in `markdown`, `template`, and `json` transforms are
pure string functions.

## Project root

For a direct input, the input's containing directory is the root. For a TOML
project, the configuration's containing directory is the root. Every configured
source, imported map, output, manifest, provenance map, `--graph` path, and
backup path is resolved beneath that root. The explicit `--out-dir` flag is the
one exception: it is resolved from the current directory and becomes the root
for that build's output.

Paths that escape the root with `..`, absolute paths, or a symbolic-link hop are
rejected. This includes output paths: a project cannot use an `out` directive
to overwrite an arbitrary file, nor can a symlinked output directory redirect a
build outside the project. The same per-component symlink check applies to
deletions by `--clean` and `refresh`, so a symlinked subdirectory cannot make
Ravel delete files outside the output directory. Deliverable names may not
collide with Ravel's own manifest files or with each other when compared
case-insensitively, so a plan behaves the same on case-insensitive file systems.
These checks are intentional policy, not merely convenience validation.

## Authorized writes

`ravel check` and `ravel inspect` perform no output writes. `ravel build`
writes only declared deliverables and its managed metadata in the chosen output
directory. Ravel stages a build before committing it so a source or evaluation
error does not leave the manifest claiming that a partial build succeeded.

The Node host writes:

- declared deliverables;
- `<deliverable>.ravelmap` provenance sidecars;
- `.ravelmap`, the aggregate provenance bundle;
- `.ravel-manifest.json` and `.manifest.txt`; and
- an explicitly requested backup ZIP.

All are identified by the manifest after a successful build.

## Clean, refresh, and backups

Ravel never treats an output directory as disposable just because it was passed
to a command. `--clean` writes the new build first and then removes only files
listed in the preceding manifest that the new build does not produce; a failed
build leaves the previous output in place. `refresh` removes only retained
stale managed files and updates the manifest. Both commands support
`--dry-run`.

`--backup [path.zip]` snapshots the current managed output — the files listed
in the previous manifest, plus the manifest itself — before a build that would
replace it. Unmanaged files in the output directory are not archived. A name
given on the command line must be new. Without a name, Ravel derives one under
`backups/` below the project root from the output directory and the previous
manifest's Unix timestamp; a name configured in TOML gets the same timestamp
appended. Derived names gain a `-2`, `-3`, … suffix rather than overwrite or
block. With no prior manifest there is nothing to archive and the backup is
skipped, so Ravel never archives or legitimizes an unrelated tree.

## What this does not protect

The project root is trusted input. A build reads the source files and TOML
configuration you select; review them — and any `[[transforms]]` modules,
which run as host code — before building an untrusted checkout.
Ravel's containment policy does not make hostile source content harmless to a
downstream compiler, runtime, deployment system, or a person who later executes
the generated artifacts. Treat generated code as code from its source authors.
