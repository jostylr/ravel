# Cross-adapter field report

This is one nontrivial Ravel program written eight ways:

- modern heading-owned Markdown
- historical LitPro Markdown
- Org
- noweb
- MyST
- AsciiDoc
- semantic HTML
- Quarto

Every source declares the same six semantic pieces. Two are live JavaScript:
`analyze` loads and validates `observations.csv`, and `publish` consumes its
immutable structured value through `ch("analyze")`. Four ordinary text pieces
materialize that value through the normal Ravel graph.

Each TOML build declares the same allowlisted resource and three host-owned
writes:

- `report.md`, a human-readable report with a generated station table
- `summary.json`, a compact machine-readable summary
- `alerts.txt`, a line-oriented operational alert log

Run every version and verify the artifacts byte for byte:

```sh
npm run example:adapters
```

Outputs appear under `.ravel/build/<format>/`. The committed files under
`expected/` are the canonical byte-level results.

To build just one format, run this from the repository root:

```sh
npm run ravel -- build \
  --config examples/adapter-conformance/ravel-org.toml
```

The permanent test additionally compares a normalized semantic map and both
live exports, so equal files cannot conceal a materially different piece
graph:

```sh
node --test test/adapter-conformance.test.mjs
```

The three final pieces deliberately use a small `RAVELEND` marker transformed
to `"\n"`. Source fence APIs differ on whether they retain a terminal newline;
making the byte explicit keeps the authored intent portable and ensures all
three text artifacts end in exactly one newline.
