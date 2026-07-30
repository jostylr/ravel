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

Historical projects select the independent LitPro adapter with
`adapter = "markdown-litpro"` and may choose `dialect = "litpro-2017"`,
`"pieceful-2020"`, or `"litpro-plus"`. Legacy `load:` directives retain the
adapter and dialect while loading their declared input; parsing never performs
other legacy effects.

Noweb sources use `.nw` or `.noweb`, or may be selected explicitly with
`adapter = "noweb"`. TOML accepts `dialect = "noweb"` or `"noweb-plus"`,
`references = "noweb"`, `"underscore-quote"`, or `"both"`, and an optional
`language`. `run = true` and `provider = "..."` retain live execution intent
as chunk metadata; loading never executes a noweb chunk or writes tangled
output.

AsciiDoc sources use `.adoc`, `.asciidoc`, or `adapter = "asciidoc"`.
Section and block pieces retain exact source bodies, pipelines, native
cross-reference navigation, and `ravel::` graph directives. Loading does not
invoke Asciidoctor or expand includes.

Org sources use `.org` or `adapter = "org"`. TOML can select
`references = "org-noweb"`, `"underscore-quote"`, or `"both"`, enable
Ravel-only use-site pipes with `noweb_pipes = true`, and assign Babel
authority with `execution_owner = "org"` or `"ravel"`. The host retains
Babel header arguments, result artifacts, and tangle requests as data; loading
does not invoke Emacs or Babel.

MyST sources use `.myst.md` or `adapter = "myst"`. Labeled `{ravel:piece}`,
`{code}`, `{code-block}`, and `{code-cell}` directives retain visible
captions, anchors, exact bodies, cross-reference navigation, front matter, and
notebook tags. TOML may assign cell authority with
`execution_owner = "myst"` or `"ravel"`; loading invokes neither MyST nor
Jupyter.

Requires Node.js 22 or newer. This package is intentionally Node-specific;
browser and Bun hosts should supply their own I/O boundary around
`@pieceful/ravel-core`.

See the [Ravel documentation](https://ravel.jostylr.com/) for TOML configuration,
filesystem safety, manifests, cleanup, and backup behavior.

MIT © James Taylor
