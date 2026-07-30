# AsciiDoc

`@pieceful/ravel-asciidoc` maps native AsciiDoc sections, source blocks,
containers, cross references, and visible directive macros into a Ravel Map.
It is a lossless standalone adapter: parsing does not invoke Asciidoctor,
expand includes, execute code, or write outputs.

AsciiDoc element attributes can carry IDs, roles, and arbitrary extension
metadata. Asciidoctor's sourcemap records block starts but not complete ranges
for metadata and inline elements, so Ravel retains exact ranges with its own
scanner. See the official
[element-attribute guide](https://docs.asciidoctor.org/asciidoc/latest/attributes/element-attributes/)
and [sourcemap documentation](https://docs.asciidoctor.org/asciidoctor/latest/api/sourcemap/).

## Section-owned pieces

An `lp-*` section ID marks a piece. Its title before the first unescaped pipe
is the visible name, and source/listing blocks remain its fragments until the
next piece section:

```asciidoc
[#lp-main]
== Main program | normalize-eol() | trim()

[source,javascript]
----
console.log(_"format-greeting");
----
```

The section anchor becomes a native AsciiDoc cross-reference target and the
semantic ID `main`. The definition pipeline runs once after all owned
fragments are concatenated.

## Self-contained blocks and containers

A titled source block can own itself:

```asciidoc
.Greeting formatter
[source#lp-format-greeting,javascript,role=lp-piece,lp-id=format-greeting]
----
const formatGreeting = "hello";
----
```

An example/open container can own several descendant source blocks:

```asciidoc
.Main program
[#lp-main,role=lp-piece,lp-id=main,lp-pipe="trim()"]
====
[source,javascript]
----
const first = true;
----

[source,javascript]
----
console.log(first);
----
====
```

Nested piece containers and self-owned blocks are excluded from their outer
piece. Fragment languages must agree. `ravel-run=true` and
`ravel-provider=...` retain live intent as inert metadata.

## Navigation and composition

AsciiDoc's native cross references navigate the rendered document:

```asciidoc
See <<lp-main,Main program>>.
See xref:lp-format-greeting[Greeting formatter].
```

They are recorded in `surface.navigation` and do not splice code.
Underscore-quote references inside source bodies remain Ravel composition:

```javascript
console.log(_"format-greeting | trim()");
```

## Visible graph directives

Ravel graph operations use conspicuous block macros:

```asciidoc
ravel::read[target=shared.adoc,as=shared]
ravel::derive[target=widget.browser,from=widget,using="minify()"]
ravel::write[target=dist/greeting.js,from=main]
```

`read`, `derive`, and `write` map to portable `in`, `create`, and `out`
directives. The adapter records them but performs no effect. An Asciidoctor
extension may later give these macros richer rendered presentation without
changing their Ravel meaning.

## Node host configuration

`.adoc` and `.asciidoc` select the adapter automatically. TOML can select it
for another extension:

```toml
version = 1

[[files]]
path = "program.txt"
adapter = "asciidoc"
run = true
provider = "quickjs-wasm-worker"
```

The checked-in `fixtures/asciidoc/native.adoc` fixture covers all three piece
forms, exact fragments, pipelines, native navigation, composition references,
and graph directives.
