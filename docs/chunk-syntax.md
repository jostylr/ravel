# Ravel embedded chunk syntax guide

## Scope

This syntax is parsed inside a Ravel Map chunk body. It is independent of
Markdown headings, HTML, AsciiDoc, and Rix blocks. Those systems create the map;
Ravel core parses the syntax below.

The initial vertical slice has one indispensable construct: substitute a named
chunk using underscore-quote notation.

    const router = _"router";

## Literals and substitutions

Everything in a chunk body is literal text except a recognized substitution.

    Chunk        = { Literal | Substitution }
    Substitution = "_" Quote Expression Quote
    Quote        = double-quote | single-quote | backtick
    Expression   = Reference { Space? "|" Space? PipeStep }
    Reference    = [ DocumentID "::" ] PiecePath
    PiecePath    = Identifier { "." Identifier }
    PipeStep     = Transform | Emit
    Transform    = Identifier [ "(" Arguments ")" ]
    Emit         = "emit" "(" String [ "," MetadataObject ] ")"
    Arguments    = Value { "," Space? Value }
    Value        = String | Number | Boolean | Null | Array | Object

Quote choices have the same Ravel meaning; choose one that avoids conflict with
surrounding target code. Opening and closing quotes must match.

    _"parser"
    _'sql-query'
    _"web-app::router"
    _"widget.browser | indent(2) | format('typescript')"

The pipeline is inside the quotes, so target-language operators remain
irrelevant to the Ravel parser.

## Escaping and errors

A backslash immediately before an underscore-quote start makes it literal:

    \_"not a reference"

The parser reports exact ranges for unmatched quotes, malformed references,
malformed transform arguments, and unexpected tokens. Resolution later reports
unknown references/transforms and cycles. It returns a partial AST after local
syntax errors so editors can continue to diagnose a document.

## Transform semantics

Transforms are registered by the core/host registry. They run left-to-right;
the prior result is their implicit first input.

    _"widget | dedent() | indent(2)"

Core transforms are pure: no filesystem, network, process, or JavaScript
evaluation. Those operations are explicit host-gated directives/effects in the
Ravel Map.

Initial intended transforms:

    concat()
    indent(columns)
    dedent()
    trim()
    normalize-eol()
    replace(search, replacement)
    quote-reference()

## Emit chunks from a pipe

An earlier draft used quote-reference only to emit a literal reference for a
later build stage. Ravel also supports the distinct and important idea of
**emitting a new named chunk from a pipe**. The special `emit` pipe step creates
a derived chunk declaration during graph expansion; it is not a filesystem or
runtime side effect.

    _`widget | dedent() | emit('widget.clean', {
      "name": "Clean widget",
      "language": "typescript",
      "tags": ["generated", "browser"],
      "data": { "target": "modern" }
    })`

This declaration means that `widget.clean` has the definition `widget |
dedent()`. Use a backtick-quoted reference when JSON metadata contains double
quotes. The emitted chunk receives the supplied display name, language,
tags, and JSON data. Its provenance includes the emit call and every source
range in the captured prefix pipeline.

`emit` is a tee: it returns the incoming value unchanged, so the enclosing
substitution may still use it. A pipe may contain more than one emit step; each
captures the prefix before that step. Use a normal transform before `emit` when
the emitted chunk needs a transform. This avoids a second, competing transform
syntax inside emit metadata.

The first implementation imposes these rules:

- the emitted ID and metadata are static literal values, known while parsing;
- the emitted ID is unique across source and other emitted chunks;
- an emission cannot overwrite or mutate an existing chunk;
- emission expands the graph before resolution/evaluation, so unknown names and
  cycles receive ordinary source-linked diagnostics;
- emitted chunks are immutable derived definitions, not copied computed text.

The Ravel Map remains the adapter output. Chunk parsing produces emission
declarations, and graph expansion adds generated chunks to the Ravel Program.
This keeps Markdown/AsciiDoc/Rix adapters unaware of the chunk-language macro.

## Resolution and provenance

A bare reference resolves in the current document. A qualified reference such
as web-app::router resolves in the named document. widget.browser is a stable
child/derived piece, not an ad hoc string scope.

Every reference stores its exact body range. Artifact provenance contains the
chunks and substitutions that contributed to it, allowing downstream errors to
point to both output and Ravel source.

## Deferred composition

Ravel does not use counted backslashes or automatic repeated compilation. To
emit a reference literally for a later explicit Ravel pass:

    _"template-reference | quote-reference()"

## Not in the first parser

Parameterized pieces, conditionals/build profiles, arbitrary JavaScript
interpolation, command execution/eval, and syntax depending on Markdown heading
depth or link behavior are all deliberately out of the first parser.
