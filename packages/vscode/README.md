# Ravel Explorer for VS Code

Experimental source-linked host for `@pieceful/ravel-explorer`.

The first vertical slice contributes `Ravel: Open Explorer`. Run it while a
supported Ravel source document or `ravel.toml` is active. The extension:

- discovers the nearest `ravel.toml`, falling back to the active source;
- evaluates the project without writing deliverables;
- opens a bounded Explorer webview beside the normal editor;
- reveals a graph entity's source range in the editor;
- requests authored and evaluated chunk text only after selection.

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
