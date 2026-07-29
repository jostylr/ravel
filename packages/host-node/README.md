# @pieceful/ravel-host-node

The Node.js host for Ravel projects. It loads Markdown, JSON Ravel Maps, and
TOML project configuration; confines project filesystem access; and safely
writes planned deliverables, manifests, provenance maps, cleanups, and backups.

```sh
npm install @pieceful/ravel-host-node
```

Use `loadBuildInput` to load a project and `writeBuildArtifacts` to write a
completed program, or use the higher-level `@pieceful/ravel` CLI. Inputs and
outputs are contained beneath an explicit project root; path escapes and
symlink traversal are rejected.

Version-1 TOML projects may declare text `[[live.resources]]` and installed
package exports in `[[live.modules]]`. The host validates and loads those
declarations; provider-specific package preparation remains outside this
general filesystem host.

`.qmd` inputs are parsed through the modern Markdown adapter before any Quarto
execution stage. Markdown entries in `ravel.toml` may select
`profile = "modern"` or retain the compatibility profile with
`profile = "fences"`.

Requires Node.js 22 or newer. This package is intentionally Node-specific;
browser and Bun hosts should supply their own I/O boundary around
`@pieceful/ravel-core`.

See the [Ravel documentation](https://ravel.jostylr.com/) for TOML configuration,
filesystem safety, manifests, cleanup, and backup behavior.

MIT © James Taylor
