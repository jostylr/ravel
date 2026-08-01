# 0.2 release checklist

Run these commands from a clean checkout using Node 22 or newer. The release
verification contract is:

```sh
npm ci
npm test
npm run test:bun
npm run test:quarto
npm run validate:schema
npm run test:browser
npm run test:pack
npm run build:site
```

Confirm the GitHub Actions Node, Bun, Chromium, and Windows jobs are green for
the release commit. Review `CHANGELOG.md`, all workspace package versions,
package metadata, and the generated tarball contents reported by
`npm run test:pack`.

## 0.2 release gate

- [x] Static composition, adapters, browser harnesses, schema checks, and
      packed-installation tests pass.
- [x] `ravel check` performs live-provider analysis without execution;
      `inspect` remains no-execute; `run` and `build` execute only explicit
      `.run` blocks.
- [x] Core exposes the version-1 live analysis, provider, request, outcome,
      plan, and program-result contracts documented in
      [the public API](public-api.md).
- [x] JavaScript execution has one final `export default`, copied/frozen
      inputs and resources, declared module imports, resource/output limits,
      and defense-in-depth dynamic-code restrictions.
- [x] The current sequential live scheduler is deterministic and reports only
      the frozen `succeeded`/`failed` execution statuses.
- [x] No live block or transform writes host files; directives and hosts remain
      the only output authority.
- [x] The read-only Explorer/browser slice remains bounded, portable, and
      free of filesystem, VS Code, shell, and network authority.
- [x] Documentation, changelog, package versions, CLI version output, Quarto
      bridge metadata, and packed smoke expectations all identify 0.2.0.

## Explicitly deferred to 0.3

The following are intentionally outside the 0.2 release gate and are tracked
in [TODO-0.3.md](../TODO-0.3.md): persistent execution caching; advanced
scheduler concurrency, stale state, trace, and cancellation semantics; richer
resource snapshots and quotas; transform modules and virtual filesystems;
large-value/performance budgets; structured Explorer editing and full VS Code
round trips; 50k-entity scale guarantees; and broad native-tool compatibility
fixtures.

## Publication

Publish packages in dependency order only after the exact release artifacts
pass the gate above:

```sh
npm publish --workspace @pieceful/ravel-core --access public
npm publish --workspace @pieceful/ravel-explorer --access public
npm publish --workspace @pieceful/ravel-js-live --access public
npm publish --workspace @pieceful/ravel-language-bridge --access public
npm publish --workspace @pieceful/ravel-map --access public
npm publish --workspace @pieceful/ravel-myst-plugin --access public
npm publish --workspace @pieceful/ravel-projection --access public
npm publish --workspace @pieceful/ravel-asciidoc --access public
npm publish --workspace @pieceful/ravel-html --access public
npm publish --workspace @pieceful/ravel-language-service --access public
npm publish --workspace @pieceful/ravel-language-typescript --access public
npm publish --workspace @pieceful/ravel-markdown --access public
npm publish --workspace @pieceful/ravel-host-browser --access public
npm publish --workspace @pieceful/ravel-markdown-litpro --access public
npm publish --workspace @pieceful/ravel-myst --access public
npm publish --workspace @pieceful/ravel-noweb --access public
npm publish --workspace @pieceful/ravel-org --access public
npm publish --workspace @pieceful/ravel-host-node --access public
npm publish --workspace @pieceful/ravel-quarto --access public
npm publish --workspace @pieceful/ravel --access public
```

The VS Code workspace is private and is not published to npm. The command
order is a topological order of the public workspace dependencies; publish all
20 packages so the exact `0.2.0`
dependencies used by the CLI and integrations resolve from npm.

Run `npm whoami` first and verify the `@pieceful` scope permissions. Publishing
is intentionally not part of the implementation task.
