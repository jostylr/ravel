# Org and Babel

`@pieceful/ravel-org` maps Org source blocks into Ravel without invoking Emacs,
Babel, an Org exporter, or a language runtime. It retains the visible,
native-compatible names and metadata that already make Org a strong literate
programming format.

The adapter follows Org's documented source-block structure and affiliated
keywords. See the official references for
[source-block structure](https://orgmode.org/manual/Structure-of-Code-Blocks.html),
[header arguments](https://orgmode.org/manual/Using-Header-Arguments.html), and
[noweb references](https://orgmode.org/manual/Noweb-Reference-Syntax.html).

## Native named blocks

```org
#+PROPERTY: pieceful-reference-style org-noweb
#+PROPERTY: pieceful-execution-owner org

#+NAME: main
#+HEADER: :session *node*
#+LP_PIPE: trim()
#+BEGIN_SRC javascript :noweb yes :results output
console.log(<<message>>);
#+END_SRC
```

`#+NAME` declares a piece. Adjacent `#+HEADER`, `#+HEADERS`, `#+LP_PIPE`, and
`#+CAPTION` lines are retained as declaration affiliations with exact ranges.
The language and switches come from `#+BEGIN_SRC`; the source body is preserved
exactly through the start of `#+END_SRC`.

File `#+PROPERTY: header-args...` settings and inherited subtree
`:header-args:` properties are combined with affiliated and block-local
arguments in Babel precedence order. Repeated arguments such as `:var` remain
ordered instead of being flattened into a lossy object.

## Repeated `:noweb-ref` groups

Org permits several blocks to share a `noweb-ref`. Ravel maps that group to one
piece with repeated fragments:

```org
#+BEGIN_SRC javascript :noweb-ref setup
first();
#+END_SRC

#+BEGIN_SRC javascript :noweb-ref setup
second();
#+END_SRC
```

If a block also has `#+NAME`, its exact body contributes both to the
individually named piece and the aggregate group. This preserves Babel's
distinction rather than forcing authors to choose one identity.

## Compact Pieceful declarations

```org
#+LP_NAME: main | normalize-eol() | trim()
#+BEGIN_SRC javascript
console.log(_"message | indent(2)");
#+END_SRC
```

`#+LP_NAME` may coexist with `#+NAME` only when their names agree. Its compact
pipeline and an adjacent `#+LP_PIPE` must also agree. Definition pipelines use
the shared Ravel grammar and run once after all fragments are concatenated.

## Reference compatibility

Reference policy is selected with:

```org
#+PROPERTY: pieceful-reference-style org-noweb
```

The supported values are:

- `org-noweb`: interpret `<<name>>` as a Ravel reference;
- `underscore-quote`: leave Org-noweb syntax for Babel and interpret
  `_"name | pipe()"`;
- `both`: accept both forms.

Piped Org-noweb syntax is a separate explicit extension:

```org
#+PROPERTY: pieceful-noweb-pipes yes

#+NAME: main
#+BEGIN_SRC text
<<message | trim()>>
#+END_SRC
```

It produces a portability warning because unmodified Babel treats the whole
text, including the pipe, as its block ID. Without the property or
`nowebPipes: true`, the pipe remains part of the strict Org-noweb name.

## Execution, results, and tangling

`#+RESULTS` is retained as an artifact and never appended to a piece body.
`:eval`, `:tangle`, `:results`, `:session`, `:cache`, and repeated `:var`
requests remain in Org fragment metadata and in an inert `org-babel` effect
plan.

A block requesting execution or tangling must have exactly one owner:

```org
#+PROPERTY: pieceful-execution-owner org
```

- `org` means Babel remains authoritative.
- `pieceful` lets an explicitly executable block become ordinary Ravel live
  metadata, still subject to the host's provider and capability boundary.

Parsing never evaluates or tangles. In particular, `:tangle` is not silently
converted into a filesystem write.

## Node host configuration

`.org` selects the adapter automatically. TOML can make the policy explicit:

```toml
version = 1

[[files]]
path = "program.org"
adapter = "org"
references = "both"
noweb_pipes = true
execution_owner = "pieceful"
run = true
provider = "quickjs-wasm-worker"
```

The portable API is:

```js
import { orgToMap } from "@pieceful/ravel-org";

const { map, diagnostics, surface } = orgToMap(source, {
  uri: "program.org",
  document: "program",
  references: "org-noweb",
  executionOwner: "org"
});
```

The surface map retains definition affiliations, fragment bodies, and exact
reference ranges. Commented and unnamed source blocks remain visible as
ignored-block metadata rather than becoming accidental pieces.
