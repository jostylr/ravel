# `@pieceful/ravel-html`

Lossless, script-free HTML source adapter for Ravel. Semantic `section` and
`figure` elements declare visible pieces; `pre > code` elements provide exact
source fragments; ordinary links can declare conspicuous graph directives.

```js
import { htmlToMap } from "@pieceful/ravel-html";

const { map, diagnostics, surface } = htmlToMap(source, {
  uri: "program.html",
  document: "program"
});
```

The adapter parses source HTML with scripting disabled. It never constructs a
browser DOM, evaluates scripts, follows links, mutates the document, executes
code, or writes outputs.

Canonical section form:

```html
<meta name="ravel-document" content="program">
<section id="lp-main"
         data-ravel-piece="main | trim()">
  <h2>Main program <code>main</code></h2>
  <pre><code class="language-javascript">console.log(_"helper");</code></pre>
</section>
```

Canonical block form:

```html
<figure id="lp-helper" data-ravel-piece="helper">
  <figcaption>Helper <code>helper</code></figcaption>
  <pre><code class="language-javascript">export const helper = true;</code></pre>
</figure>
```

Visible `<a>` and `<data>` elements with `data-ravel-effect` declare `read`,
`derive`, and `write` graph operations. `data-lp-*` remains a compatibility
alias for the earlier design spelling.
