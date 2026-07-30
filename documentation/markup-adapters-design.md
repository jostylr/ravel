# Markup adapter design

## Status

Proposed design for discussion. This document extends
`syntax-proposal-07-17-26.md`; it does not replace the core Piece Document,
reference, transform, effect, or capability model defined there.

In this document, **piece** means the semantic unit also called a full block or
chunk in earlier LitPro writing. A source document may contain many pieces.

## Decision summary

1. There is one Pieceful semantic language and one public, source-mapped Piece
   Document IR. Markup adapters only recognize authoring conventions and map
   them to that IR.
2. The modern Markdown adapter allows heading-owned pieces and fence-owned
   pieces to coexist. An unnamed fence belongs to the current heading piece;
   a named fence declares only itself and does not change that heading context.
3. A separate `markdown-litpro` adapter preserves the original LitPro
   structure, including peer H1-H4 blocks, relative H5/H6 blocks, repeated
   headings, minor blocks, link directives, and legacy reference paths.
4. Definition pipelines are available after piece names in every adapter.
   They run once after all fragments of that piece have been concatenated.
5. Quarto is a specialization and renderer integration for the Markdown
   adapter, not a separate compiler language.
6. In rendered documents, every piece must have a visible display name and a
   stable anchor. A format integration should also show `uses` and `used by`
   links generated from the resolved graph.
7. The canonical Quarto block form uses Quarto code-listing labels and captions.
   This addresses the invisible-fence-name problem without inventing a second
   presentation system.
8. AsciiDoc should initially support a section form and an attributed source
   block form. Its native block titles, IDs, roles, custom attributes, and
   cross references are a good fit.
9. HTML should use ordinary semantic elements plus `data-lp-*` attributes.
   Custom elements may enhance the result but are not the canonical source
   representation.
10. Org and noweb are first-class input adapters. Org maps Babel names,
    `noweb-ref` groups, and noweb references into the Piece Document. The noweb
    adapter supports strict-compatible and pipe-extended dialects.
11. MyST Markdown remains a high-value later adapter for directive-oriented
    scientific documents and notebooks.

## Goals

- Preserve the visible, narrative quality of the old heading-oriented style.
- Also support self-contained blocks that can be moved without moving an
  enclosing section.
- Allow definition pipelines after names in every source format and apply them
  consistently after fragment concatenation.
- Parse traditional Org/Babel and noweb structures without requiring their
  execution engines.
- Give Markdown, Quarto, AsciiDoc, HTML, Org, noweb, notebooks, and future
  rich-text hosts the same piece graph and effect plan.
- Preserve exact source ranges for definitions, literal fragments, references,
  transforms, and directives.
- Make piece identity and graph navigation useful in the rendered document, not
  only in compiler internals.
- Keep ordinary rendering useful when the Pieceful extension is absent.
- Never require a markup renderer to execute Pieceful effects while parsing.

## Non-goals

- Making every feature of a host format part of Pieceful.
- Treating Quarto/Jupyter execution order as Pieceful dependency order.
- Reimplementing Quarto, Asciidoctor, Babel, or browser rendering.
- Making the modern Markdown adapter emulate legacy LitPro; that responsibility
  belongs to the separate `markdown-litpro` adapter.
- Allowing markup-specific syntax to leak into the core resolver.

## Adapter contract

Every adapter implements the same conceptual interface:

```ts
interface MarkupAdapter {
  readonly format: string;
  parse(input: SourceText, options: AdapterOptions): AdapterResult;
}

type AdapterResult = {
  document: PieceDocument;
  surface: SurfaceMap;
};

type SurfaceMap = {
  definitions: readonly DefinitionSurface[];
  references: readonly ReferenceSurface[];
  directives: readonly DirectiveSurface[];
  navigation?: readonly NavigationSurface[];
};

type DefinitionSurface = {
  pieceId: string;
  declaration: Range;
  fragments: readonly Range[];
  sourceAnchor?: string;
  renderedAnchor?: string;
  displayName: string;
};

type ReferenceSurface = {
  ownerPieceId: string;
  targetText: string;
  source: Range;
};

type NavigationSurface = {
  targetPieceId: string;
  targetLabel: string;
  syntax: "link" | "role" | "shorthand";
  source: Range;
};
```

The `PieceDocument` remains the compiler input. `SurfaceMap` records how the
semantic objects appear in this particular markup. It supports render filters,
an LSP, go-to-definition, dependency summaries, and generated-document links
without teaching the core about headings, fences, or HTML nodes.

All adapters must:

- preserve the document URI and exact source offsets;
- emit the same AST for Pieceful references and pipelines regardless of markup;
- distinguish a piece declaration from its display name;
- preserve literal fragments before markup rendering or syntax highlighting;
- plan effects as data rather than performing them;
- diagnose duplicate IDs, ambiguous inferred IDs, and unsupported mixtures;
- provide a stable rendered anchor whenever the host format supports one.

## Identity and display

A piece has three related but distinct names:

| Property | Purpose | Example |
| --- | --- | --- |
| semantic ID | Pieceful references and graph identity | `format-greeting` |
| display name | prose and rendered caption | `Greeting formatter` |
| rendered anchor | host-format navigation | `lp-format-greeting` or `lst-lp-format-greeting` |

The semantic ID uses the grammar in `syntax-proposal-07-17-26.md`. An adapter
must not expose a host's reserved prefix as part of the semantic ID.

Explicit semantic IDs are canonical for block-local declarations. For heading
declarations, deriving an ID from the visible heading is intentionally
supported because it is the main attraction of the older style. An explicit
anchor can stabilize the ID across a heading rename.

## Definition pipelines in markup adapters

Every adapter can attach a definition pipeline to a piece declaration:

```text
piece-name | transform-one() | transform-two("argument")
```

The first unescaped pipe ends the name. `\|` represents a literal pipe where
the host markup permits it. The shared pipeline parser, not the markup adapter,
parses the remainder.

A definition pipeline applies to the complete piece:

1. collect all literal fragments;
2. concatenate them in the adapter-defined order;
3. parse references in the concatenated value;
4. apply the definition pipeline once;
5. apply a consumer's inline pipeline, if any, at the reference site.

It never runs separately on each fragment. This matters for transforms such as
formatting, trimming, templating, or parsing a complete file.

Each format may also provide a native attribute spelling when literal pipes
would interfere with the host parser:

| Format | Compact spelling | Native/attribute spelling |
| --- | --- | --- |
| Markdown heading | <code>## Main &#124; trim()</code> | `lp-pipe="trim()"` on a heading attribute |
| Markdown fence | <code>javascript lp:main &#124; trim()</code> in the info string | `lp-pipe="trim()"` |
| Quarto | same heading form | `lp-pipe="trim()"` on the listing |
| AsciiDoc | <code>== Main &#124; trim()</code> | `lp-pipe="trim()"` block attribute |
| Org | <code>#+LP_NAME: main &#124; trim()</code> | adjacent `#+LP_PIPE:` keyword |
| noweb-plus | <code>&lt;&lt;main &#124; trim()&gt;&gt;=</code> | `@ %pieceful pipeline ...` pragma |
| HTML | n/a | `data-lp-pipe="trim()"` |

The two spellings must normalize to the same pipeline AST. Supplying both with
different values is an error.

## Modern Markdown adapter (`markdown`)

### Headings and named fences coexist

The modern adapter does not force a document to choose between a heading style
and a fence style. It maintains an **ambient heading piece** while parsing:

- an enabled heading declares a piece and becomes the ambient owner;
- an unnamed fence contributes to the ambient heading piece;
- a named fence declares or appends to its explicitly named piece only;
- a named fence does not replace the ambient heading owner;
- the next enabled heading changes the ambient owner;
- an unnamed fence with no ambient owner is ordinary example code unless the
  document config chooses to diagnose it.

Example:

````markdown
## Main program | normalize-eol()

The first and third blocks belong to `main-program`.

```javascript
console.log(_"helper");
```

```javascript lp:helper | trim()
function helper() {
  return "hello";
}
```

```javascript
console.log("done");
```
````

This produces:

- `main-program`: the first and third JavaScript fragments, concatenated with
  one newline, then passed through `normalize-eol()`;
- `helper`: only the named middle fence, then passed through `trim()`.

The fragment language/info string is always preserved. An unnamed
`javascript` fence under `Main program` is still named by the heading, not by
`javascript`; the language belongs to the fragment metadata. If all nonempty
fragment languages agree, the piece inherits that language. Incompatible
languages produce `LP150` unless a registered composition policy handles them.

### Heading declarations

The visible form is:

```markdown
## Main program | trim() | normalize-eol()
```

`Main program` is both the display name and, absent an explicit ID, the source
of the inferred semantic ID `main-program`. For Pandoc/Quarto Markdown, an
explicit anchor stabilizes the ID:

```markdown
## Main program | trim() {#lp-main}
```

The adapter strips the `lp-` anchor prefix, so the semantic ID is `main`.
The pipeline is excluded from both the display name and inferred ID. A render
integration should render only `Main program` as the heading and may show the
pipeline separately as a small definition badge.

Heading recognition is independently configurable:

```yaml
---
lp:
  adapter: markdown
  document: greeting
  headings:
    enabled: true
    levels: [2, 3, 4, 5, 6]
    hierarchy: flat
---
```

Modern heading hierarchy is `flat`: level affects document presentation but
not piece identity. `enabled: false` (or `headings: none`) makes every heading
narrative-only while named fences continue to work. A project may choose any
level set. The default treats an initial H1 as the document title and H2-H6 as
piece declarations.

### Unnamed fences and the first-fence pipeline

An unnamed fence contributes to the ambient heading piece:

````markdown
## Main program

```javascript | trim() | normalize-eol()
first();
```

```javascript
second();
```
````

The pipeline on the first owned fence is the definition pipeline for
`main-program`; it applies once to `first();\nsecond();`. The heading remains
the name. This form is useful when the author wants the visible heading to stay
free of compiler notation.

Rules:

- only the first unnamed fence owned by a heading may supply the heading
  piece's pipeline;
- a heading pipeline and first-fence pipeline may not both be supplied unless
  they normalize identically;
- a pipeline on a later unnamed fence is an error, because fragment-local
  transformation would have different semantics;
- the language is the text before the first pipe;
- an empty language is allowed.

For Pandoc/Quarto compatibility, the attribute form is:

````markdown
```{.javascript lp-pipe="trim() | normalize-eol()"}
first();
```
````

### Named fences

The compact CommonMark form is:

````markdown
```javascript lp:helper | trim()
function helper() {}
```
````

The Pandoc/Quarto form is:

````markdown
```{.javascript .lp-piece #lp-helper lp-title="Helper" lp-pipe="trim()"}
function helper() {}
```
````

The two forms are semantically equivalent. In the compact form, the semantic ID
after `lp:` is also the default display name. In the attribute form:

- `.lp-piece` marks the declaration;
- `#lp-helper` supplies the rendered anchor and default semantic ID `helper`;
- `lp-title` supplies an optional display name;
- `lp-pipe` supplies the definition pipeline.

A later fragment can append explicitly:

````markdown
```{.javascript .lp-fragment lp-for="helper"}
helper.extra = true;
```
````

An explicit append does not change the ambient heading owner. Its language is
preserved like any other fragment.

### Directives in modern Markdown links

The modern adapter recognizes only the compact, typed LP2 link directives:

```markdown
[Write the entry point](dist/greeting.js "lp:write from main")

[Browser form](#lp-widget "lp:derive browser | minify()")

[Read shared definitions](shared.qmd "lp:read as shared")
```

The link text and destination remain useful when Pieceful is absent. The
adapter parses the title into a typed AST and plans any effect; it does not
execute effects while walking the Markdown tree.

## Full LitPro Markdown adapter (`markdown-litpro`)

This is a separate adapter, not a mode inside modern Markdown. Its purpose is
to reproduce the original source structure and naming rules closely enough to
load the old book, implementation, and fixture corpus without first rewriting
the documents.

### Default heading model

The default deliberately keeps the unusual model:

- H1, H2, H3, and H4 are peer major-piece declarations. Markdown outline depth
  does not affect their Pieceful identity.
- H5 declares a slash child of the most recent major piece:
  `major/h5-name`.
- H6 declares a slash grandchild:
  `major/h5-name/h6-name`. With no preceding H5 it retains the legacy empty
  path segment behavior.
- Minor blocks declared by links append a colon:
  `major:minor`, `major/h5:minor`, or `major/h5/h6:minor`.
- repeated H1-H4 names reopen and concatenate the same piece;
- repeated H5/H6 paths follow the legacy path rules rather than being globally
  merged solely by visible heading text;
- all fenced and indented code blocks under the current legacy block are
  fragments, and their info/language strings are preserved.

H5 and H6 were intended for tightly related topical material such as
documentation and tests, but `doc` and `test` were conventions, not hard-coded
roles. The adapter must preserve arbitrary H5/H6 names.

Relative legacy references are retained and resolved structurally:

```text
./child
../sibling
../../major
:minor
../:minor
document::major/h5:minor
```

### Heading pipes and historical dialects

The original LitPro documentation disallowed pipes in headings. The later
Pieceful CommonMark prototype split a heading at its first pipe and stored the
remainder as a definition transformation. Both behaviors matter.

The adapter therefore supports:

```yaml
lp:
  adapter: markdown-litpro
  dialect: litpro-plus
```

Dialects:

| Dialect | Heading hierarchy | Heading pipelines |
| --- | --- | --- |
| `litpro-2017` | exact H1-H4/H5/H6 legacy model | disabled, matching original LitPro |
| `pieceful-2020` | same relative model as the prototype | enabled and accumulated on repeated definitions |
| `litpro-plus` | legacy structure with LP2 typed pipelines | enabled; default for new legacy-style documents |

`litpro-plus` is the default. Use `litpro-2017` for exact fixture
compatibility. In `litpro-plus`, this is valid:

```markdown
##### Documentation | trim() | normalize-eol()
```

The semantic path uses `documentation`; the pipeline runs after every fragment
contributing to that full path has been concatenated.

### Configurable heading-level meaning

Front matter can retain the default hierarchy, flatten selected levels, or
disable heading declarations:

```yaml
lp:
  adapter: markdown-litpro
  headings:
    mode: legacy
    major: [1, 2, 3, 4]
    child: 5
    grandchild: 6
    pipelines: true
```

Supported modes:

- `legacy`: use the configured major/child/grandchild roles;
- `flat`: every configured level is a peer major piece;
- `none`: headings are narrative only. Named-fence declarations remain
  available as an explicit extension so a document is not left without a way
  to declare pieces.

Omitted configuration uses the traditional H1-H4/H5/H6 assignments above.
Changing them is recorded in the Piece Document metadata and build trace so
two hosts cannot silently interpret the same source differently.

### Other legacy constructs to preserve

The adapter recognizes and source-maps:

- `_"name"`, `_'name'`, and `` _`name` `` substitutions;
- scope `::`, minor `:`, slash hierarchy, and relative-path resolution;
- use-site pipe commands and their legacy argument escaping;
- counted/delayed substitutions such as `\1_"name"`;
- repeated heading and minor-block concatenation;
- `[minor]()` and `[minor](# ": | commands")` switches;
- the `[^]`-style return-to-major switch behavior;
- link-title directives such as `save:`, `load:`, `out:`, `store:`, and
  parsing directives;
- the compiler-visible `<!--+ ... -->` convention;
- legacy heading normalization and collision behavior.

Structure, names, references, pipelines, directive requests, and source ranges
must be reproducible. Unsafe legacy effects are still planned rather than run
automatically. An opt-in restricted legacy host may emulate an effect only
through explicit capabilities.

The compatibility baseline is the historical syntax description in
`book-all/manuscript/part-1/symphonic-programming.md`, the H5/H6 fixture in
`tests/tests-lib/h5.md`, the original parser in `src/commonmark.md`, and the
later heading-pipeline behavior in `pieceful-programming/src/commonmark.md`.
Each legacy construct should have a fixture identifying which implementation
and dialect it came from.

Legacy syntax is not translated by the modern Markdown adapter. A migration
command may parse with `markdown-litpro`, emit the Piece Document, and then
rewrite unambiguous constructs into modern Markdown.

## Quarto

### Relationship to Markdown

Quarto uses Pandoc Markdown and already understands headings with IDs, fenced
Divs, attributed code blocks, code-cell labels, captions, listings, and cross
references. Therefore `.qmd` uses the Markdown adapter plus a Quarto
integration. There is no `format: "quarto"` Piece Document and no Quarto-only
resolver. A project normally selects modern `markdown`, though
`markdown-litpro` can also feed the Quarto render bridge for historical books.

The integration has two independent jobs:

1. **Build bridge** — run pure Pieceful parsing/resolution/weaving before Quarto
   executes code, producing a temporary source tree and source maps.
2. **Render bridge** — decorate Quarto's Pandoc AST with visible piece identity,
   links, graph summaries, and diagnostics.

Keeping these jobs separate prevents a Lua render filter from becoming a
second Pieceful compiler.

### Heading-owned pieces in Quarto

Modern heading ownership works directly and may include a pipeline:

````markdown
## Main program | normalize-eol() {#lp-main}

```{.javascript}
console.log(_"format-greeting");
```
````

The heading makes the name prominent and gives the piece a normal hyperlink
target. The Quarto integration may add a small `piece: main` badge next to the
heading, followed by graph navigation:

> Uses: [format-greeting](#lp-format-greeting) · Used by: none

The render bridge removes the pipeline suffix from the displayed heading and
may show it as a separate badge. The badge is useful but not required to
understand the rendered document.

### Named fences in Quarto: make the name visible

For static code, prefer Quarto's native listing syntax:

````markdown
```{.javascript .lp-piece #lst-lp-main lp-id="main" lst-cap="Main program" lp-pipe="normalize-eol()"}
console.log(_"format-greeting");
```

See @lst-lp-main.
````

Quarto renders `Main program` as a visible listing caption and turns
`@lst-lp-main` into a numbered hyperlink. Pieceful takes the semantic ID from
`lp-id`; if it is absent, it may strip `lst-lp-` from the listing label.

This is the no-extension baseline. The render bridge can reduce the source
boilerplate by deriving a default caption and listing label from:

````markdown
```{.javascript .lp-piece #lp-main lp-title="Main program" lp-pipe="normalize-eol()"}
console.log(_"format-greeting");
```
````

It transforms that block into the equivalent Quarto listing in the Pandoc AST.
The source remains readable in renderers that do not load the bridge.

For an executable cell, Quarto's native spelling adds curly brackets around
the language name. The example below deliberately shows the non-executable
`python` fence so this `.md` design document remains ordinary Markdown; change
it to `{python}` in a `.qmd` document to make Quarto execute it.

````markdown
::: {#lp-analysis .lp-piece lp-id="analysis" lp-pipe="trim()"}

```python
#| lst-label: lst-lp-analysis
#| lst-cap: "Analysis"

print(_"prepared-data")
```

:::
````

The build bridge must weave `prepared-data` into a temporary `.qmd` before the
Jupyter or Knitr engine sees the cell. Quarto remains responsible for executing
the resulting cell and rendering its output. Pieceful `execute` effects are
disabled in this path unless separately and explicitly requested, preventing
double execution.

### Reference and definition navigation

There are three progressively richer navigation levels:

1. **No extension** — piece definitions are native section or listing anchors;
   authors can use normal links or Quarto listing references.
2. **Portable rendered enhancement** — under each definition, generate `Uses`
   and `Used by` links. Add a piece index/dependency appendix. This works in
   HTML, PDF, and other Quarto outputs because it is ordinary Pandoc content.
3. **HTML/editor enhancement** — use the source map to make individual
   `_"piece"` occurrences navigable, show hover previews, and support
   go-to-definition. Exact token links are an HTML and editor feature, not a
   requirement for all output formats.

Quarto code annotations can associate prose with source lines, but they require
language-specific comment markers in the code. The integration should not
rewrite arbitrary target-language source merely to inject annotations.
Generated `Uses` links are safer and work for every language.

### Pipeline and cache ordering

The supported render pipeline is:

```text
source .qmd
  -> Pieceful adapter and graph validation
  -> pure weaving into a temporary .qmd tree + source maps
  -> Quarto execution
  -> Pandoc/Quarto render bridge
  -> HTML/PDF/etc.
```

Rules:

- never overwrite the author's `.qmd` during rendering;
- preserve a composed source map through the temporary file;
- key Quarto freeze/cache inputs on the woven temporary content and Pieceful
  plugin versions, not only the original `.qmd`;
- report Quarto execution errors against the original piece/reference chain
  where the engine supplies usable generated locations;
- do not let Quarto shortcodes, filters, or executed output declare new
  Pieceful pieces after graph validation.

## AsciiDoc

AsciiDoc has unusually good raw materials for an adapter: section IDs, titled
source blocks, arbitrary element attributes, roles, cross references, and an
extension API over its parsed document tree.

### Section form

```asciidoc
[#lp-main]
== Main program | normalize-eol()

The entry point delegates formatting.

[source,javascript]
----
console.log(_"format-greeting");
----

[#lp-format-greeting]
== Greeting formatter

[source,javascript]
----
function formatGreeting(name) {
  return `Hello, ${name}!`;
}
----
```

As with a Markdown heading-owned piece:

- section title before the first pipe is the visible display name;
- `lp-main` maps to semantic ID `main`;
- source/listing blocks in the section become fragments;
- the next configured piece section ends ownership;
- section depth does not create Pieceful namespaces;
- the pipeline runs once after the section's fragments are concatenated.

AsciiDoc can link to the piece using its native cross-reference syntax:

```asciidoc
See <<lp-format-greeting,Greeting formatter>>.
```

### Block form

One source block can declare a self-contained piece:

```asciidoc
.Main program
[source#lp-main,javascript,role=lp-piece,lp-id=main,lp-pipe="normalize-eol()"]
----
console.log(_"format-greeting");
----
```

The block title is visible, `#lp-main` is a native anchor, `role=lp-piece`
marks the declaration and maps to a useful HTML class, and `lp-id=main` is a
custom element attribute available to the adapter.

For narrative and several fragments inside one piece, use an open/example
container with a title, ID, and role:

```asciidoc
.Main program
[#lp-main,role=lp-piece,lp-id=main,lp-pipe="normalize-eol()"]
====
The entry point has two fragments.

[source,javascript]
----
console.log(_"format-greeting");
----

[source,javascript]
----
console.log("done");
----
====
```

The adapter takes descendant source blocks as fragments and excludes nested
`.lp-piece` containers.

### AsciiDoc directives

The native-looking canonical form is a small set of block macros:

```asciidoc
lp::write[target=dist/greeting.js,from=main]

lp::derive[target=widget.browser,from=widget,using="minify()"]

lp::read[target=shared.adoc,as=shared]
```

`lp` is the block-macro name and `write`, `derive`, or `read` is its target.
An Asciidoctor extension renders each macro as visible prose/a link and records
its attributes. The standalone adapter recognizes exactly the same grammar
without requiring Asciidoctor to perform an effect.

This syntax is preferable to hiding directives in comments or overloading
ordinary links. It also makes effects conspicuous in the source.

### Implementation choices and limitations

Use Asciidoctor's parsed Document API rather than parsing rendered HTML. Enable
its source-map option and inspect sections, blocks, IDs, roles, titles, and
custom attributes. A tree processor is appropriate for rendering graph
decorations; custom block macros are appropriate for directive presentation.

Asciidoctor source mapping provides block start locations, not complete
character ranges for all blocks or inline nodes. The adapter must therefore
pair AST nodes with a lossless source scanner to recover:

- metadata-line ranges;
- block end offsets;
- exact code content ranges;
- exact `_"..."` reference and pipeline ranges inside literal source.

The AST chooses structure; the scanner supplies exact offsets. Includes need
their own URI-aware source maps because a single logical AsciiDoc document may
contain blocks from several files.

## HTML

HTML is both a useful authoring format and an important rendered interchange
format. The canonical source form should be valid, meaningful HTML even when no
Pieceful script is installed.

### Section form

```html
<meta name="lp-document" content="greeting">

<section id="lp-main"
         data-lp-piece="main"
         data-lp-pipe="normalize-eol()">
  <h2>Main program <code>main</code></h2>
  <p>The entry point delegates formatting.</p>
  <pre><code class="language-javascript">console.log(_"format-greeting");</code></pre>
</section>
```

### Block form

```html
<figure id="lp-main"
        data-lp-piece="main"
        data-lp-language="javascript"
        data-lp-pipe="normalize-eol()">
  <figcaption>Main program <code>main</code></figcaption>
  <pre><code class="language-javascript">console.log(_"format-greeting");</code></pre>
</figure>
```

Both forms make the display name visible, provide a native anchor, and degrade
well. Standard elements carry accessibility and rendering semantics;
`data-lp-*` carries private Pieceful metadata.

Directives use ordinary links with explicit data:

```html
<a href="dist/greeting.js"
   data-lp-effect="write"
   data-lp-from="main">Write the entry point</a>
```

Derived pieces may use a visible `<a>` or `<data>` element, but effects that
identify an external resource should remain links.

### Parsing and safety

- Parse source with a location-preserving HTML parser in scripting-disabled
  mode; never execute document scripts.
- Extract literal code from the text content of `<pre><code>`.
- Preserve a character map when decoding entities such as `&lt;`, because one
  output character may occupy several source bytes.
- Reject duplicate element IDs and duplicate semantic piece IDs.
- Ignore runtime DOM mutations. The source HTML, not browser state, is the
  reproducible input.
- Do not use `<template>` as the default piece container: its content is
  intentionally not rendered, which recreates the visibility problem.

Autonomous custom elements such as `<lp-piece>` could provide an interactive
HTML-only viewer, but standard elements plus data attributes remain canonical.
Unknown custom elements have weak fallback semantics, require styling, and
would complicate non-HTML conversion.

## Org adapter (`org`)

Org is a first-class adapter, not only an importer. It already has visible
source-block names, repeated noweb groups, source languages, heading trees,
header arguments, references, execution, and tangling.

### Native-compatible piece declarations

The adapter recognizes a named Babel source block:

```org
#+NAME: main
#+LP_PIPE: normalize-eol() | trim()
#+BEGIN_SRC javascript
console.log(<<format-greeting>>);
#+END_SRC
```

`#+NAME` remains fully meaningful to Org. The adjacent `#+LP_PIPE` keyword is
Pieceful metadata that Org can otherwise ignore. The pipeline applies after
all fragments of `main` have been collected.

Org's `:noweb-ref` header argument groups several blocks under one shared
reference. Pieceful maps that group to repeated fragments:

```org
#+BEGIN_SRC javascript :noweb-ref main
first();
#+END_SRC

#+BEGIN_SRC javascript :noweb-ref main
second();
#+END_SRC
```

The blocks concatenate as `first();\nsecond();`. A `#+NAME` identifies one
block; a shared `:noweb-ref` identifies the aggregate. If both are present,
the named block may be addressed individually while also contributing to the
aggregate, matching Org's distinction.

### Compact Pieceful Org spelling

For authors using Pieceful rather than Babel as the primary engine, the adapter
also accepts:

```org
#+LP_NAME: main | normalize-eol() | trim()
#+BEGIN_SRC javascript
console.log(<<format-greeting>>);
#+END_SRC
```

This places the pipeline directly after the name without changing how Org
interprets `#+NAME`. A renderer extension displays `main` and its pipeline near
the block. `#+LP_NAME` and `#+NAME` may coexist only when their names agree.

### References and use-site pipes

In `org-noweb` reference mode:

```org
<<format-greeting>>
```

maps to the same Pieceful reference AST as `_"format-greeting"`. The extended
form allows a use-site pipeline:

```org
<<format-greeting | indent(2)>>
```

Org Babel would interpret the entire text, including the pipe, as a block ID.
Therefore a document that must remain executable by unmodified Babel should
use Pieceful's underscore-quote reference for piped consumption:

```org
_"format-greeting | indent(2)"
```

Front matter/property configuration selects one policy:

```org
#+PROPERTY: pieceful-reference-style org-noweb
#+PROPERTY: pieceful-execution-owner org
```

Reference styles are `org-noweb`, `underscore-quote`, or `both`. Execution
owners are `org` or `pieceful`; a build must never expand/evaluate the same
block through both engines.

### Headings, results, and tangling

Org headings remain narrative by default. An opt-in heading mode can mirror
modern Markdown ambient ownership, but named source blocks are the canonical
Org declaration because their names stay visible in the source.

`#+RESULTS` blocks are artifacts, not piece fragments. Babel's `:tangle`,
`:eval`, `:results`, cache, sessions, and variables are preserved as Org
metadata. Pieceful does not reinterpret them as pure transforms. When Org owns
execution/tangling, Pieceful supplies the validated dependency graph and woven
block bodies; Org performs the native operation. When Pieceful owns it, those
requests become capability-gated effects.

### Org source maps

Use an Org syntax tree for element boundaries and a lossless scanner for exact
reference/pipeline ranges. Preserve affiliation keywords (`#+NAME`,
`#+LP_NAME`, `#+LP_PIPE`, `#+HEADER`) as part of the declaration surface.

## noweb adapter (`noweb`)

The strict adapter parses ordinary noweb documentation and code chunks:

```noweb
The entry point delegates greeting construction.

<<main>>=
console.log(<<format-greeting>>);
@

<<format-greeting>>=
function formatGreeting(name) {
  return "Hello, " + name;
}
@
```

Rules:

- `<<name>>=` begins a definition;
- `@` returns to documentation;
- `<<name>>` inside code is a reference;
- repeated definitions of the same name concatenate in source order;
- documentation preceding a chunk becomes its narrative/display context;
- the chunk name is the semantic ID source after adapter normalization;
- root/output chunks are planned as artifacts rather than written while
  parsing.

Classic noweb does not encode a source language in the chunk declaration. The
adapter takes language from project configuration, root filename conventions,
or an explicit Pieceful pragma and records any inference.

### noweb-plus pipes

The `noweb-plus` dialect allows definition and use-site pipelines directly
after a name:

```noweb
<<main | normalize-eol() | trim()>>=
console.log(<<format-greeting | indent(2)>>);
@
```

The first unescaped pipe separates the classic chunk name from the typed
Pieceful pipeline. This is intentionally an extension: an unmodified noweb
tool would treat the full text, including pipes, as the chunk name.

For a source that must remain consumable by classic noweb, use a documentation
pragma for the definition pipeline and underscore-quote syntax for piped
references:

```noweb
@ %pieceful pipeline main | normalize-eol() | trim()
<<main>>=
console.log(_"format-greeting | indent(2)");
@
```

The pragma is attached to the next matching definition by the Pieceful
adapter; classic `notangle` continues to see the ordinary `main` chunk.

### noweb dialect and compatibility policy

```yaml
lp:
  adapter: noweb
  dialect: noweb-plus
  references: both
```

Supported dialects:

- `noweb`: preserve exact chunk names; do not split names at pipes;
- `noweb-plus`: split definition and reference names at the first unescaped
  pipe and parse the remainder as an LP2 pipeline.

Reference policy is `noweb`, `underscore-quote`, or `both`. Repeated
definitions may each declare pipelines only if the normalized pipelines agree;
the pipeline still runs once after concatenation.

The parser should be a small, lossless line scanner. It records documentation,
definition openers, body segments, references, terminators, and exact offsets
without requiring TeX, `noweave`, or `notangle`.

## Other promising formats

### MyST Markdown — high priority after the initial adapters

MyST already has directive blocks, labels, captions, cross references, code
cells, and notebook integration. A Pieceful MyST plugin can provide a dedicated
directive whose argument follows the shared name-and-pipeline rule:

```markdown
:::{piece} main | normalize-eol() | trim()
:language: javascript
:caption: Main program

console.log(_"format-greeting");
:::
```

The plugin renders through MyST's normal code, label, and caption nodes while
the adapter emits the same Piece Document as other formats. A no-plugin
fallback may use the built-in `{code-block}` directive with an `lp-*` label and
no Pieceful-only options. MyST is attractive for scientific books and
notebooks where Quarto is not the chosen renderer.

The implemented adapter uses the following mapping:

- the `{piece}` argument supplies the authored name and optional definition
  pipeline;
- `:label:` supplies the stable MyST anchor and semantic ID after removing an
  optional `lp-` prefix;
- `:caption:` is the visible display name and `:language:` is language
  metadata;
- native `{code}`/`{code-block}` and `{code-cell}` directives are recognized
  as no-plugin fallbacks only when their label begins with `lp-`;
- underscore-quote references inside exact directive bodies enter the Ravel
  dependency graph;
- MyST links, `{ref}`/`{numref}` roles, and `@label` shorthand are retained
  separately in `SurfaceMap.navigation`, because document navigation must not
  acquire code-composition semantics.

Both colon and backtick fences are scanned losslessly. A target in `(label)=`
form immediately before the directive is equivalent to `:label:`; if both are
present they must agree. Repeated directives concatenate only when they resolve
to the same semantic ID, their pipelines agree, and they do not reuse a
rendered label.

`{code-cell}` and `{piece}` with `:cell:` retain page front matter, cell tags,
and an inert `myst-code-cell` effect plan. MyST is the default execution owner.
Pieceful live execution requires explicit `pieceful` ownership plus an explicit
run request; parsing itself invokes neither MyST nor Jupyter.

`.myst.md` selects the adapter in the Node host. Ordinary `.md` remains normal
Markdown unless its TOML entry declares `adapter = "myst"`.

### reStructuredText/Sphinx — possible, below MyST

Its directives, targets, and code blocks can express pieces cleanly, but MyST
offers a similar directive model with Markdown and notebook alignment. Add
reStructuredText when an actual Sphinx project needs it rather than for format
completeness.

### Typst — renderer first, source adapter later

Typst has raw code blocks, labels, references, and programmable show rules. It
could render a Piece Document attractively. Its source language also executes
document expressions, so a safe, exact-range source adapter is a separate and
larger commitment. Treat Typst output as the initial goal.

### Formats not recommended initially

- **MDX** mixes markup with executable JavaScript/JSX and creates an avoidable
  trust and parsing boundary.
- **DocBook/XML** is structurally capable but has a high authoring cost; HTML
  and AsciiDoc cover the likely use cases.
- **Renderer-specific HTML comments** make compiler semantics invisible and
  cause the source, rendered document, and Piece Document to disagree.

## Cross-format equivalence

The following declarations must yield equivalent semantic pieces:

| Format/form | Visible name source | Semantic ID source | Fragment source |
| --- | --- | --- | --- |
| Modern Markdown heading | heading text before pipe | `#lp-*` or inferred slug | unnamed fences under heading |
| Modern Markdown fence | `lp-title` / rendered caption | `lp:*`, `#lp-*`, or `lp-id` | named/append fence |
| LitPro Markdown major | H1-H4 text before optional pipe | legacy normalized heading | all code under current block |
| LitPro Markdown relative | H5/H6 text before optional pipe | major/H5/H6 legacy path | all code under current block |
| Quarto listing | `lst-cap` | `lp-id` or `lst-lp-*` | listing/cell body |
| AsciiDoc section | section title before pipe | `#lp-*` or inferred slug | source blocks in section |
| AsciiDoc block | block title | `lp-id` / `#lp-*` | source block/container descendants |
| HTML section/block | heading or figcaption | `data-lp-piece` | descendant `pre > code` |
| MyST | directive caption | directive label | directive body |
| Org | `#+NAME` or `#+LP_NAME` | declared name / `:noweb-ref` | source block body |
| noweb | chunk definition | text inside `<<...>>=` before pipe | chunk body |

Adapter-independent conformance fixtures should compare normalized Piece
Documents rather than rendered HTML.

## Diagnostics added by adapters

| Code | Meaning |
| --- | --- |
| LPA100 | Missing or unknown adapter/dialect configuration. |
| LPA101 | Piece has no visible display name. |
| LPA102 | Piece ID was inferred from mutable display text. |
| LPA103 | Host anchor uses a reserved or invalid prefix. |
| LPA110 | Code block has ambiguous piece ownership. |
| LPA111 | Fragment refers to an unknown piece. |
| LPA112 | Nested piece/fragment ownership is invalid. |
| LPA113 | Pipeline appears on a later fragment or conflicts with another declaration pipeline. |
| LPA114 | Host-native tooling would interpret a pipe-extended name differently. |
| LPA120 | Markup parser could not provide an exact source range. |
| LPA121 | Included source URI is missing or outside the allowed input set. |
| LPA130 | Render integration cannot represent a requested navigation feature. |
| LPA140 | Quarto attempted execution before Pieceful weaving. |
| LPA141 | Org/Babel and Pieceful both claim execution or tangling ownership. |

An inferred ID (`LPA102`) is informational for an enabled heading declaration
and a warning for a block-local declaration.

## Conformance and test plan

Each adapter needs fixtures for:

1. one piece and one fragment;
2. several fragments joined in source order;
3. visible display name distinct from semantic ID;
4. local and cross-document references with exact ranges;
5. a reference cycle and dependency path;
6. typed directives with no effects performed during parsing;
7. ignored/example blocks;
8. duplicate IDs and malformed attributes;
9. Unicode and entity/escape source mapping;
10. nested sections/containers;
11. included files, where supported;
12. a pipeline declared after the name and applied once after concatenation;
13. host-compatible versus pipe-extended Org/noweb spellings;
14. modern Markdown named fences interleaved with ambient unnamed fences;
15. LitPro H1-H4 peers, H5/H6 relative paths, repeated headings, and minors;
16. an equivalent Piece Document shared by all format fixtures.

Quarto adds golden renders for HTML and PDF showing:

- visible piece captions;
- working definition links;
- `uses` and `used by` links;
- a piece index;
- an execution error mapped through a woven temporary cell.

## Recommended delivery order

1. Finalize the adapter and `SurfaceMap` interface.
2. Implement modern Markdown with coexisting heading and fence declarations.
3. Implement `markdown-litpro` against the legacy fixture corpus and expose
   the `litpro-2017`, `pieceful-2020`, and `litpro-plus` dialects.
4. Implement the small lossless noweb/noweb-plus scanner.
5. Implement Org names, `noweb-ref` aggregation, references, and pipeline
   metadata without execution.
6. Implement a Quarto no-extension example using native listings, then add the
   render bridge for graph links and a piece index.
7. Add the Quarto pre-execution build bridge only after static rendering is
   sound.
8. Implement HTML, which will exercise entity-aware source mapping.
9. Implement AsciiDoc with block-level source maps plus lossless rescanning.
10. Add MyST when a scientific-book/notebook project needs it.

## Open decisions

1. Should modern Markdown default to H2-H6 ambient ownership, or require a
   project to enable heading declarations explicitly?
2. Should `markdown-litpro` default to `litpro-plus` as proposed, or default to
   exact `litpro-2017` and require opting into heading pipelines?
3. Is an inferred heading ID acceptable without a diagnostic in an explicitly
   selected legacy-style document?
4. Should `#lp-main` alone mark a named-fence declaration, or must
   `.lp-piece` always be present? Requiring the class is less magical.
5. Should the Quarto bridge always number pieces as listings, or support an
   unnumbered `Piece: main` caption style?
6. Should AsciiDoc retain the single generic block macro
   (`lp::write[target=...]`), or use a styled delimited block for directives
   that need richer visible prose?
7. Should `<<name | pipeline>>` be enabled by `noweb-plus`/Org configuration
   only, or recognized with a portability warning whenever encountered?
8. Which system owns execution in an Org or notebook workflow? The default
   should be the native host, with Pieceful limited to pure graph assembly.

## Recommendation

Prototype the same five-piece example in:

- modern Markdown with a named fence between two heading-owned fragments;
- `markdown-litpro` with H1-H4, H5/H6, a minor, and a repeated heading;
- strict noweb and noweb-plus;
- Org using `#+NAME`, `:noweb-ref`, and `#+LP_PIPE`;
- Quarto using native `lst-*` captions;
- AsciiDoc section form;
- HTML `<figure data-lp-piece>` form.

Compare their normalized Piece Documents and rendered navigation. That small
vertical slice will test the adapter boundary, visible naming, graph links, and
source maps before committing to more grammars.

## External references

- [Quarto Markdown basics](https://quarto.org/docs/authoring/markdown-basics.html)
- [Quarto cross references and code listings](https://quarto.org/docs/authoring/cross-references/)
- [Quarto code annotations](https://quarto.org/docs/authoring/code-annotation.html)
- [Quarto filter extensions](https://quarto.org/docs/extensions/filters.html)
- [AsciiDoc source blocks](https://docs.asciidoctor.org/asciidoc/latest/verbatim/source-blocks/)
- [AsciiDoc block IDs](https://docs.asciidoctor.org/asciidoc/latest/blocks/assign-id/)
- [AsciiDoc element attributes](https://docs.asciidoctor.org/asciidoc/latest/attributes/element-attributes/)
- [Asciidoctor source maps](https://docs.asciidoctor.org/asciidoctor/latest/api/sourcemap/)
- [MyST directives](https://mystmd.org/guide/directives)
- [MyST cross references](https://mystmd.org/guide/cross-references)
- [Org header arguments and `noweb-ref`](https://orgmode.org/manual/Using-Header-Arguments.html)
- [Org noweb reference syntax](https://orgmode.org/manual/Noweb-Reference-Syntax.html)
- [Org source extraction](https://orgmode.org/manual/Extracting-Source-Code.html)
- [noweb guide and pipeline representation](https://www.cs.tufts.edu/~nr/noweb/guide.html)
- [HTML custom data attributes](https://html.spec.whatwg.org/dev/dom.html#custom-data-attribute)
