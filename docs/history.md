# History and starting point

Ravel begins as a clean implementation, but it is not a blank idea. It carries
forward lessons from three earlier JavaScript projects in the adjacent
literate-programming workspace.

## Original Literate Programming / Litpro

The first system used Markdown documents as the authoring format. Headings and
code blocks formed named sections; underscore-quote references assembled
sections recursively; links and link titles expressed minor blocks,
transformations, loading, saving, and directives.

Its enduring strengths are narrative order distinct from program assembly,
compact named-piece composition, local variants and pipelines, a substantial
corpus of examples, and the insight that document I/O should be separable from
compilation.

Its limits were architectural rather than conceptual: parsing, scheduling,
effects, diagnostics, plugins, mutable scopes, and logs shared a large mutable
runtime. Syntax was distributed among Markdown conventions and string parsing.
Ravel preserves the authoring ideas but replaces that runtime.

## event-when

event-when explored central event dispatch, scoped facts, dependency waits, and
an observable processing log. Its declarative intuition remains useful for
explaining builds: when prerequisites are ready, a result becomes ready.

Ravel does not use an event bus as compiler control flow. It represents
dependencies directly as a graph and evaluates the graph with native async
operations. The monitoring idea survives as an optional structured trace API
that records parsing, evaluation, cache state, effects, and errors without
determining execution.

## Pieceful Programming

Pieceful Programming made the key architectural break: separate format parsing
from processing code pieces. A CommonMark parser or another adapter can produce
a web of pieces, and a core can resolve that web.

Ravel adopts this separation as an explicit contract:

    format/profile adapter → Ravel Map → chunk parser/resolver → Ravel Program

The old prototype is design evidence and fixture material, not a code
dependency. Its incomplete implementation, generated-package layout, and legacy
dependency tree are deliberately not carried into Ravel.

## Why a new repository

The prior workspace contains an outer repository plus nested repositories and
both literate sources and generated package trees. Ravel starts with one Git
repository, one workspace manifest, generated output excluded from source, and
a small public contract before a large implementation.

Migration is selective: preserve examples, documentation, and tests as
historical evidence; select a fixture-backed compatibility subset; translate old
Markdown conventions through a legacy profile when useful; and teach only Ravel
syntax in new material.

