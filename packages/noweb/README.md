# `@pieceful/ravel-noweb`

Lossless, portable noweb input adapter for [Ravel](https://github.com/jostylr/ravel). It recognizes ordinary
`<<name>>=` definitions, repeated fragments, `<<name>>` references, `@`
terminators, preceding documentation, configured or filename-inferred
languages, and classic-compatible Ravel pragmas. Parsing never runs code or
writes tangled output.

```js
import { nowebToMap } from "@pieceful/ravel-noweb";

const { map, diagnostics, surface } = nowebToMap(source, {
  uri: "program.nw",
  document: "program",
  language: "javascript",
});
```

The default `noweb` dialect treats pipes as part of classic chunk names.
`dialect: "noweb-plus"` enables definition and use-site pipelines:

```noweb
<<main | trim()>>=
console.log(<<message | indent(2)>>);
@
```

This extended spelling produces a portability warning. For a source that
classic noweb should continue to consume, declare the definition pipeline in
documentation and use underscore-quote references for piped uses:

```noweb
@ %ravel pipeline main | trim()
<<main>>=
_"message | indent(2)"
@
```

Other supported documentation pragmas are:

```noweb
@ %ravel language main | javascript
@ %ravel output main | dist/main.js
@ %ravel run main | provider=quickjs-wasm-worker
```

Live metadata is only planned. A host still owns provider selection and
execution.
