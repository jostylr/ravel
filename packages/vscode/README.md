# Ravel Explorer for VS Code

Experimental source-linked host for `@pieceful/ravel-explorer`.

The first vertical slice contributes `Ravel: Open Explorer`. Run it while a
supported Ravel source document or `ravel.toml` is active. The extension:

- discovers the nearest `ravel.toml`, falling back to the active source;
- evaluates the project without writing deliverables;
- opens a bounded Explorer webview beside the normal editor;
- reveals a graph entity's source range in the editor;
- focuses the narrowest graph entity when the editor selection changes;
- requests authored and evaluated chunk text only after selection;
- reevaluates dirty project documents as one debounced in-memory preview;
- shows deterministic node and edge change counts without writing artifacts;
- enables a Changes lens that keeps removed entities visible and distinguishes
  added, changed, and removed graph structure;
- compares saved and candidate authored/evaluated text after selecting a
  changed chunk, transform, directive, or deliverable, highlighting removals
  in red and additions in green;
- renders deliverable text as selectable provenance segments and explains the
  definition, dependency path, derivation steps, and retained transform origins
  for the clicked generated character;
- distinguishes exact character mappings from coarse transform attribution and
  reveals the corresponding source range in the normal editor;
- shows generated occurrences for the active editor selection and opens an
  occurrence directly in its deliverable provenance;
- keeps a bounded Back history across graph nodes, deliverables, and generated
  character offsets.

Command-click a source-linked Ravel reference, or put the cursor on it and
press F12, to jump to the defining chunk. The provider follows the exact
authored reference ranges in the current Explorer revision.

The webview defaults to a vertical ELK layout for typical editor-column
dimensions. A toolbar control switches to horizontal layout when that better
matches the project. The Changes lens becomes available whenever the project
has a valid dirty-buffer preview; saving or reverting the buffer returns to the
normal dependency lens. The graph occupies the upper portion of the webview and
the full-width selection details and diff occupy the lower portion so code
comparisons retain useful line width.

## Generated-code prototype

The extension also projects the current unsaved Ravel program into virtual
target-language documents. A CodeLens above a piece reports its generated
occurrence count. The following Command Palette actions operate on the current
source or generated selection:

- **Ravel: Open Generated Occurrence** opens a mapped occurrence beside the
  source editor and asks which artifact to use when the source is ambiguous.
- **Ravel: Next Generated Occurrence** and **Ravel: Previous Generated
  Occurrence** move among expansions of the same piece.
- **Ravel: Return from Generated Code to Source** follows exact provenance, or
  the best available source anchor, from the generated cursor.
- **Ravel: Select Analysis Target** persists a target/artifact fallback for the
  current source document and the exact projection/occurrence for the selected
  piece. A piece choice takes priority only inside that piece and survives
  requests made in other pieces. `ravel.defaultTarget` supplies a workspace or
  project default when no explicit choice exists.

Selecting a target is not enough when that target contains several applicable
artifacts. Ravel asks for an artifact choice in that case; it does not silently
choose the lexically first artifact.

Generated text uses the target language ID for syntax coloring. A status item
shows the artifact and target, with the expansion breadcrumb in its tooltip.
Decorations distinguish the selected fragment and piece, descendants,
surrounding context, transformed text, and synthetic text. Open virtual views
are marked stale while an unsaved source change is being recomputed and refresh
only after a complete projection is available. Decorations, status, and
return-to-source navigation are withheld unless the text currently loaded in
the virtual editor exactly equals the registry's current projection text.

The generated-document provider carries the originating source selection into
the context presenter, including during next/previous occurrence navigation.
This is what drives the exact `selected-fragment` overlay; it is separate from
the highlight for the entire selected piece occurrence.

The same current in-memory projection backs native TypeScript and JavaScript
completion details, hover, signature help, definitions, type definitions,
references, document symbols, diagnostics, exact-safe rename, and incoming and
outgoing call hierarchy in authored code fences. Cross-artifact imports are
synchronized as one target project. Browser and server targets use isolated
TypeScript projects and registries. Pending dirty-buffer projection work is
completed before an interactive request, and stale native results are
discarded.

Call hierarchy keeps the chosen target, artifact, and occurrence on each item.
The language service's `selectionRange` is reverse-mapped independently and is
used as the cursor for later incoming/outgoing requests, avoiding a re-query at
the start of a broader declaration range.

Target diagnostics are requested with an exact projection and occurrence route.
Publication rechecks the active project, editor source capture, and diagnostic
generation, and a failure from a stale project cannot clear diagnostics already
published by the current one.

The manifest activates when a workspace contains `ravel.toml`, the Explorer
command is invoked, or a Markdown, Quarto, Org, AsciiDoc, or HTML editor opens,
so these providers do not depend on the Explorer panel having been visible
first. Standalone `.nw`/`.noweb` inputs are loadable after activation (for
example, in a configured Ravel workspace), but do not yet have their own
language contribution or activation event.

Only exact single-destination edits are exposed as automatic edits. Completion
entries that require an unresolved import/code action are withheld; exact
rename edits are version-checked and reverse-mapped into one VS Code workspace
edit. Synthetic, opaque, ambiguous, stale, conflicting, external, or structural
edits are refused by the transport-neutral classifier.

## Trust, source authority, and project confinement

Target-language tooling is disabled while the VS Code workspace is untrusted;
the in-process TypeScript bridge is not constructed. Ravel-native parsing,
graph navigation, diagnostics, generated previews, and occurrence navigation
continue to work. Granting workspace trust resets the language router and
synchronizes the current generated documents.

The bridge receives a minimal generated-file record: stable identity and
version, language, generated text, target/artifact/stage, and a small allowlist
of logical path/configuration metadata. Projection maps, authored source text,
line indexes, occurrence internals, and source-write authority stay in Ravel's
projection/router boundary. TypeScript configuration search is rooted at the
loaded Ravel project; explicit and discovered `tsconfig.json` paths are refused
if their lexical or canonical path escapes that root.

This config-location rule is not a complete filesystem sandbox. After trust is
granted, TypeScript still performs ordinary configured-file, project-reference,
module, declaration, and standard-library lookup through its native host, which
can read a dependency outside the Ravel root. Returned editor navigation is
still root-confined. A configurable file-access-root policy remains M7 work.

The writable authored-source allowlist comes from the non-JSON source inputs
that the Node host actually loaded. Dirty overlays for JSON Ravel Maps are
honored during evaluation, but a file path merely declared as source metadata
inside a map does not enter that allowlist. A project containing any JSON map
is conservatively read-only for automatic mapped source edits, including when
that map imports an otherwise authored markup file. Candidate paths are also
canonicalized and confined beneath the project root. JSON maps and
`ravel.toml` remain in a separate loaded-input refresh list, so dirty overlays
still invalidate and rebuild generated state without gaining write authority.

Automatic workspace edits require a declared writable exact mapping, an
allowlisted source URI, and equality between the selected projection's captured
source version and the current nonnegative editor version. Evaluation overlays,
projection source metadata, registry publication, diagnostics, and language
requests derive from the same immutable capture of all open buffers. A relevant
open/close, text, version, or dirty-state change retries synchronization or
fails closed. The host has versions only for open authored documents, so a
rename or other workspace edit touching a closed or otherwise unversioned file
fails closed. Primary completion edits operate only in the current open
document and recheck project, generation, projection, and editor authority;
unresolved additional edits are withheld. Malformed or oversized
language-service edit responses are rejected before reverse mapping.

The project also retains the exact authored text consumed by evaluation.
Read-only definition, diagnostic, call, and generated-to-source navigation may
open a previously closed source without forcing a rebuild only when the opened
document is clean and its text exactly matches that retained value. This does
not grant a document version or write authority; completion, rename, and all
automatic workspace edits continue to use the stricter captured-editor check.

This remains a prototype. There is no editor preview/apply workflow for
ambiguous or structural edits, configured imports-piece creation policy, or
piece-ID refactoring. Diagnostic-centered generated context, accessibility and
disappearing-occurrence acceptance, and an Extension Host test proving actual
save/read-only behavior remain open. The repository has an activation smoke
test, but not a full VS Code Extension Host interaction suite. These focused
trust and confinement controls do not constitute the complete M7 threat model,
so the strict milestone gates remain open.

## Development

From the repository root:

```sh
npm run build:vscode
```

Open the repository in VS Code and run the `Ravel Explorer extension` launch
configuration. In the Extension Development Host, open
`examples/migration/ravel-fizzbuzz.toml` and run `Ravel: Open Explorer` from the
Command Palette.

This package is private while the extension and protocol are experimental.
