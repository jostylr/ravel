# Ravel Explorer for VS Code

Experimental source-linked host for `@pieceful/ravel-explorer`.

The first vertical slice contributes `Ravel: Open Explorer`. Run it while a
supported Ravel source document or `ravel.toml` is active. The extension:

- discovers the nearest `ravel.toml`, falling back to the active source;
- evaluates the project without writing deliverables;
- opens a bounded Explorer webview beside the normal editor;
- reveals a graph entity's source range in the editor;
- focuses the narrowest graph entity when the editor selection changes;
- requests authored and evaluated chunk text only after selection;
- reevaluates dirty project documents as one debounced in-memory preview;
- shows deterministic node and edge change counts without writing artifacts;
- enables a Changes lens that keeps removed entities visible and distinguishes
  added, changed, and removed graph structure;
- compares saved and candidate authored/evaluated text after selecting a
  changed chunk, transform, directive, or deliverable, highlighting removals
  in red and additions in green.

Command-click a source-linked Ravel reference, or put the cursor on it and
press F12, to jump to the defining chunk. The provider follows the exact
authored reference ranges in the current Explorer revision.

The webview defaults to a vertical ELK layout for typical editor-column
dimensions. A toolbar control switches to horizontal layout when that better
matches the project. The Changes lens becomes available whenever the project
has a valid dirty-buffer preview; saving or reverting the buffer returns to the
normal dependency lens.

## Development

From the repository root:

```sh
npm run build:vscode
```

Open the repository in VS Code and run the `Ravel Explorer extension` launch
configuration. In the Extension Development Host, open
`examples/migration/ravel-fizzbuzz.toml` and run `Ravel: Open Explorer` from the
Command Palette.

This package is private while the extension and protocol are experimental.
