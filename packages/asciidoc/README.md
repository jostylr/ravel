# `@pieceful/ravel-asciidoc`

Lossless AsciiDoc source adapter for Ravel. It recognizes section-owned pieces,
attributed source blocks and containers, native cross references, exact code
bodies, definition pipelines, live metadata, and visible `ravel::` directive
macros without invoking Asciidoctor or executing code.

```js
import { asciidocToMap } from "@pieceful/ravel-asciidoc";

const { map, diagnostics, surface } = asciidocToMap(source, {
  uri: "program.adoc",
  document: "program"
});
```

Section form:

```asciidoc
[#lp-main]
== Main program | trim()

[source,javascript]
----
console.log(_"helper");
----
```

Self-contained block form:

```asciidoc
.Main program
[source#lp-main,javascript,role=lp-piece,lp-id=main,lp-pipe="trim()"]
----
console.log(_"helper");
----
```

Graph directives remain conspicuous block macros:

```asciidoc
ravel::write[target=dist/main.js,from=main]
ravel::read[target=shared.adoc,as=shared]
```

The adapter is native ESM and portable across Node, Bun, and browsers.
