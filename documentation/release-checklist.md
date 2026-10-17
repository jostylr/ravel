# Release checklist

Use this list for every release. It replaces the per-version checklists kept
in the archived plans.

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

## Release gate

- [ ] Every command above passes on the release commit.
- [ ] `npm audit --omit=dev` reports no known vulnerabilities in runtime
      dependencies, or each remaining one is explained in the changelog.
- [ ] Every workspace `package.json`, the inter-package dependency pins, the
      CLI `--version` output (`packages/cli/src/index.js`), the js-live
      provider version, the Quarto bridge version, and the packed-smoke and
      Quarto-bridge test expectations all name the new version.
- [ ] `CHANGELOG.md` has a dated entry listing user-visible changes, including
      any package published for the first time.
- [ ] [ROADMAP.md](https://github.com/jostylr/ravel/blob/main/ROADMAP.md) is
      updated: shipped items removed from "Next", known limitations current.
- [ ] The documentation site is rebuilt into `docs/` and committed.
- [ ] `ravel check` performs live-provider analysis without execution;
      `inspect` remains no-execute; `run` and `build` execute only explicit
      `.run` blocks.
- [ ] No live block or transform writes host files; directives and hosts remain
      the only output authority.

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
20 packages so the exact-version dependencies used by the CLI and
integrations resolve from npm. Tag the release commit `vX.Y.Z` after
publishing.

Run `npm whoami` first and verify the `@pieceful` scope permissions. Publishing
is intentionally not part of the implementation task.
