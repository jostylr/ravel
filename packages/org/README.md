# `@pieceful/ravel-org`

Portable Org/Babel input adapter for Ravel. It recognizes `#+NAME`,
`#+LP_NAME`, `#+LP_PIPE`, `#+HEADER`, source languages, `:noweb-ref`
aggregation, Org-noweb references, result artifacts, and Babel header
arguments without invoking Emacs, Babel, or a language runtime.

```js
import { orgToMap } from "@pieceful/ravel-org";

const { map, diagnostics, surface } = orgToMap(source, {
  uri: "program.org",
  document: "program"
});
```

Select `org-noweb`, `underscore-quote`, or `both` references. Piped
`<<name | trim()>>` references require `nowebPipes: true` and produce a
compatibility warning because unmodified Babel treats the full text as its
block ID.

Execution and tangling are never performed while parsing. A document that
requests either must explicitly select `org` or `ravel` ownership:

```org
#+PROPERTY: ravel-execution-owner org
#+PROPERTY: ravel-reference-style org-noweb
```

When Ravel owns an explicitly executable block, the adapter emits live
metadata for the ordinary capability-gated Ravel execution stage. Babel
header arguments and `#+RESULTS` remain available as Org metadata and inert
effect plans.
