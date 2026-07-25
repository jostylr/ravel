# Filesystem safety and trust boundaries

Ravel's portable graph evaluator is static: it parses documents, resolves
chunks, applies its documented string transforms, and plans outputs. It does
not execute document JavaScript, shell commands, network requests, or arbitrary
user code. Filesystem access is supplied only by `@pieceful/ravel-host-node`
and the CLI.

## Project root

For a direct input, the input's containing directory is the default root. For a
TOML project, the configuration's containing directory is the root. `--root`
may select an explicit root. Every configured source, imported map, output,
manifest, provenance map, and default backup path is resolved beneath that
root.

Paths that escape the root with `..`, absolute paths, or a symbolic-link hop are
rejected. This includes output paths: a project cannot use an `out` directive
to overwrite an arbitrary file, nor can a symlinked output directory redirect a
build outside the project. These checks are intentional policy, not merely
convenience validation.

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
to a command. `--clean` removes only files listed in the preceding manifest,
then builds afresh. `refresh` removes only retained stale managed files and
updates the manifest. Both commands support `--dry-run`.

`--backup [path.zip]` snapshots the current managed output before a build that
would replace it. A named archive must be new. Without a name, Ravel derives a
name under `backups/` below the project root from the output directory and the
previous manifest's Unix timestamp. Backup creation requires a valid prior
manifest so it cannot accidentally archive or legitimize an unrelated tree.

## What this does not protect

The project root is trusted input. A build reads the source files and TOML
configuration you select; review them before building an untrusted checkout.
Ravel's containment policy does not make hostile source content harmless to a
downstream compiler, runtime, deployment system, or a person who later executes
the generated artifacts. Treat generated code as code from its source authors.
