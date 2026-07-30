# HTML

`@pieceful/ravel-html` maps authored HTML directly into a Ravel Map. It parses
source with scripting disabled and source locations enabled; it never creates
a browser DOM, executes document scripts, observes mutations, follows links,
executes code, or writes outputs.

The adapter uses parse5's location-preserving HTML parser. Its location mode
attaches source offsets to explicit nodes while leaving parser-inserted nodes
without invented source locations. See the official
[parse5 parser options](https://parse5.js.org/interfaces/parse5.ParserOptions.html)
and the [WHATWG parsing model](https://html.spec.whatwg.org/multipage/parsing.html).

## Semantic pieces

A section owns every descendant `pre > code` fragment whose nearest piece
ancestor is that section:

```html
<meta name="ravel-document" content="greeting">

<section id="lp-main"
         data-ravel-piece="main | normalize-eol() | trim()">
  <h2>Main program <code>main</code></h2>
  <p>The entry point delegates formatting.</p>
  <pre><code class="language-javascript">console.log(_"helper");</code></pre>
</section>
```

A figure is a self-contained visible piece:

```html
<figure id="lp-helper"
        data-ravel-piece="helper"
        data-ravel-language="javascript">
  <figcaption>Helper <code>helper</code></figcaption>
  <pre><code>export const helper = true;</code></pre>
</figure>
```

The heading or `figcaption` supplies the visible display name. The nested
`code` label may show the semantic name without becoming part of that display
name. Nested pieces own their own code and are excluded from the outer piece.

`data-ravel-pipe`, `data-ravel-language`, `data-ravel-run`, and
`data-ravel-provider` supply explicit metadata. A pipeline may instead follow
the piece name after a pipe. `data-lp-*` and `lp-document` remain compatibility
aliases.

## Entities and source maps

HTML text content decodes character references:

```html
<pre><code>if (left &lt; right &amp;&amp; ready) run();</code></pre>
```

Ravel emits `if (left < right && ready) run();`. Ordinary text retains exact
UTF-16 source mapping. Each decoded entity becomes a coarse fragment covering
its complete authored reference, so provenance never claims that one output
character corresponds byte-for-byte to `&lt;` or `&#60;`.

The same treatment applies to HTML newline normalization. Native Unicode text
that requires no adaptation remains exact.

## Navigation and graph directives

Ordinary anchors navigate the rendered source and do not compose code:

```html
<a href="#lp-helper">Read the helper</a>
```

Graph effects remain visible standard elements:

```html
<a href="shared.html"
   data-ravel-effect="read"
   data-ravel-as="shared">Read shared pieces</a>

<data value="main.min.js"
      data-ravel-effect="derive"
      data-ravel-from="main"
      data-ravel-using="minify()">Derive the minified program</data>

<a href="dist/main.js"
   data-ravel-effect="write"
   data-ravel-from="main">Write the program</a>
```

These become portable `in`, `create`, and `out` directives. Parsing performs
none of their effects.

## Safety boundary

Only authored source structure participates. JavaScript strings that contain
piece-like markup cannot create pieces, and the adapter deliberately does not
traverse `<template>` contents because they are not visible by default.
Duplicate element IDs and duplicate semantic piece IDs are diagnosed.

`.html` and `.htm` select the adapter automatically in the Node host. TOML may
select it for another extension:

```toml
version = 1

[[files]]
path = "program.txt"
adapter = "html"
run = true
provider = "quickjs-wasm-worker"
```

The checked-in `fixtures/html/native.html` fixture covers sections, figures,
nesting, entities, Unicode, native navigation, composition references, graph
directives, scripts, and templates.
