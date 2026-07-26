# @pieceful/ravel-map

The versioned public contract for Ravel Maps: schema metadata, structural
validation, and stable diagnostic data.

```sh
npm install @pieceful/ravel-map
```

Import `validateRavelMap` to receive diagnostics as data, or `assertRavelMap`
when an invalid map should stop a host operation. The package also exports
`RAVEL_MAP_VERSION`, `RAVEL_MAP_SCHEMA`, and the JSON schema entry point
`@pieceful/ravel-map/schema`.

This package validates map shape; graph resolution and evaluation belong to
`@pieceful/ravel-core`. It is native ESM and portable across browser, Bun, and
Node hosts.

See the [Ravel documentation](https://ravel.jostylr.com/) for the Ravel Map
schema and compatibility contract.

MIT © James Taylor
