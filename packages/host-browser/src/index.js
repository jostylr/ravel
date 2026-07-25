import {
  combineMaps,
  createDeliverableProvenanceMap,
  transformGraph
} from "@pieceful/ravel-core";
import { validateRavelMap } from "@pieceful/ravel-map";
import { markdownToMap } from "@pieceful/ravel-markdown";

const point = () => ({ line: 0, column: 0, offset: 0 });

const hostDiagnostic = (error, uri) => ({
  code: "RB100",
  severity: "error",
  message: error?.message ?? String(error),
  source: {
    uri,
    range: { start: point(), end: point() }
  }
});

/**
 * Render one in-memory Markdown document through the portable Ravel pipeline.
 *
 * This host intentionally has no filesystem, process, network, load, or export
 * surface. The caller owns the source string and any copy/paste interaction.
 */
export const renderMarkdownDocument = (source, options = {}) => {
  const uri = options.uri ?? "playground.md";
  const mode = options.mode ?? "opt-in";

  try {
    const adapted = markdownToMap(source, {
      uri,
      mode,
      ...(options.document ? { document: options.document } : {})
    });
    const validationDiagnostics = validateRavelMap(adapted.map, { uri });
    const program = transformGraph(combineMaps([adapted.map]), {
      transforms: options.transforms
    });
    const diagnostics = [
      ...adapted.diagnostics,
      ...validationDiagnostics,
      ...program.diagnostics
    ];
    const deliverables = Object.values(program.deliverables).map((deliverable) => ({
      ...deliverable,
      provenanceMap: createDeliverableProvenanceMap(deliverable)
    }));

    return {
      version: 1,
      source: { uri, document: adapted.map.document.id },
      map: adapted.map,
      program,
      deliverables,
      diagnostics,
      ok: diagnostics.every((entry) => entry.severity !== "error")
    };
  } catch (error) {
    return {
      version: 1,
      source: { uri, document: options.document ?? null },
      map: null,
      program: null,
      deliverables: [],
      diagnostics: [hostDiagnostic(error, uri)],
      ok: false
    };
  }
};
