# 0.1 release checklist

Run these commands from a clean checkout using Node 22 or newer. The full
repository suite is the release verification contract:

```sh
npm ci
npm test
npm run test:bun
npm run validate:schema
npm run test:browser
npm run test:pack
npm run build:site
```

Confirm the GitHub Actions Node, Bun, Chromium, and Windows jobs are green for
the release commit. Review `CHANGELOG.md`, package versions, package metadata,
and the generated tarball contents reported by `npm run test:pack`.

## First publication

Publish packages in dependency order from the repository root:

```sh
npm publish --workspace @pieceful/ravel-map --access public
npm publish --workspace @pieceful/ravel-core --access public
npm publish --workspace @pieceful/ravel-markdown --access public
npm publish --workspace @pieceful/ravel-host-node --access public
npm publish --workspace @pieceful/ravel --access public
```

Run `npm whoami` first, authenticate with `npm login` if necessary, and ensure
the `@pieceful` scope has permission to publish public packages. The commands
must run only after every package has the intended shared version, because npm
does not permit replacing an already-published version.

## Trusted publishing follow-up

After the first manual publication creates each npm package, configure npm's
Trusted Publisher setting for each package to accept the GitHub repository
`jostylr/ravel`, the selected release workflow file, and (if used) its GitHub
environment. A release workflow then needs `contents: read` and `id-token:
write` permissions and can run `npm publish` without storing an npm token.
Keep that workflow separate from ordinary pull-request verification.

## Tag and release

When the checks and publication have succeeded, create an annotated release tag
from the verified commit:

```sh
git tag -a v0.1.1 -m "Ravel 0.1.1"
git push origin v0.1.1
```

Then create the GitHub release using the matching `v0.1.1` tag and the
highlights in `CHANGELOG.md`.
