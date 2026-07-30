# @pieceful/ravel-markdown-litpro

The historical LitPro Markdown adapter for Ravel. It preserves the unusual
H1-H4 peer model, H5/H6 slash paths, repeated definitions, link-created minor
pieces, legacy underscore-quote references, and planned legacy directives.

```sh
npm install @pieceful/ravel-markdown-litpro
```

```js
import { litproMarkdownToMap } from "@pieceful/ravel-markdown-litpro";

const result = litproMarkdownToMap(source, {
  uri: "book.md",
  dialect: "litpro-plus"
});
```

Supported dialects are `litpro-2017`, `pieceful-2020`, and `litpro-plus`.
Heading modes are `legacy`, `flat`, and `none`. `litpro-plus` is the default.

The adapter never executes code or performs a legacy directive. Fences marked
`.run` only produce the same portable live metadata used by other Ravel
adapters. Unsafe or not-yet-portable legacy directives are retained as planned
effects in map metadata.

MIT © James Taylor
