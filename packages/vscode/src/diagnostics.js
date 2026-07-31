const severityOrder = Object.freeze({ error: 0, warning: 1, info: 2, hint: 3 });
const allTargetDiagnosticCategories = Object.freeze([
  "configuration",
  "compilerOptions",
  "syntactic",
  "semantic",
  "suggestion"
]);
const syntaxTargetDiagnosticCategories = Object.freeze([
  "configuration",
  "compilerOptions",
  "syntactic"
]);
const javascriptLanguageIds = new Set(["javascript", "javascriptreact"]);

export const targetDiagnosticCategories = ({
  languageId,
  javascriptMode = "all"
} = {}) => {
  if (!javascriptLanguageIds.has(languageId)) return allTargetDiagnosticCategories;
  if (javascriptMode === "off") return [];
  if (javascriptMode === "syntax") return syntaxTargetDiagnosticCategories;
  return allTargetDiagnosticCategories;
};

export const hasDiagnosticPublicationAuthority = ({
  project,
  activeProject,
  refreshPending,
  sourceStateCurrent
}) => Boolean(
  project &&
  project === activeProject &&
  refreshPending === false &&
  sourceStateCurrent === true
);

export const hasDiagnosticRunAuthority = ({
  project,
  activeProject,
  refreshPending,
  requestGeneration,
  currentGeneration,
  router,
  currentRouter,
  projectionService,
  currentProjectionService,
  aborted = false
}) => Boolean(
  project &&
  project === activeProject &&
  refreshPending === false &&
  requestGeneration === currentGeneration &&
  router === currentRouter &&
  projectionService === currentProjectionService &&
  aborted === false
);

export const diagnosticProjectionRouting = (projection, anchor) => ({
  targetId: projection?.targetId,
  artifactId: projection?.artifactId,
  stage: projection?.stage,
  projectionId: projection?.id,
  ...(anchor?.occurrenceId === undefined
    ? {}
    : { occurrenceId: anchor.occurrenceId })
});

const position = (value) => ({
  line: Number.isInteger(value?.line) ? value.line : 0,
  character: Number.isInteger(value?.column) ? value.column : 0
});

const range = (value) => ({
  start: position(value?.start),
  end: position(value?.end)
});

const keyFor = (entry) => JSON.stringify([
  entry.uri,
  entry.range.start.line,
  entry.range.start.character,
  entry.range.end.line,
  entry.range.end.character,
  entry.code,
  entry.severity,
  entry.message,
  entry.targetId,
  entry.artifactId
]);

const compare = (left, right) =>
  left.range.start.line - right.range.start.line ||
  left.range.start.character - right.range.start.character ||
  left.range.end.line - right.range.end.line ||
  left.range.end.character - right.range.end.character ||
  severityOrder[left.severity] - severityOrder[right.severity] ||
  String(left.code).localeCompare(String(right.code)) ||
  left.message.localeCompare(right.message);

export const normalizeRavelDiagnostics = (diagnostics, options = {}) => {
  const normalized = [];
  const seen = new Set();
  for (const diagnostic of diagnostics ?? []) {
    const source = diagnostic.source;
    if (!source?.uri || !source?.range || typeof diagnostic.message !== "string") continue;
    const resolved = options.resolveUri?.(source.uri) ?? source.uri;
    if (!resolved) continue;
    const entry = {
      uri: String(resolved),
      range: range(source.range),
      code: diagnostic.code ?? "RAVEL",
      severity: ["error", "warning", "info", "hint"].includes(diagnostic.severity)
        ? diagnostic.severity
        : "info",
      message: diagnostic.message,
      source: diagnostic.origin ?? diagnostic.sourceName ?? "ravel",
      related: (diagnostic.related ?? []).flatMap((related) => {
        const uri = options.resolveUri?.(related?.uri) ?? related?.uri;
        return uri && related?.range
          ? [{ uri: String(uri), range: range(related.range), message: related.message ?? diagnostic.message }]
          : [];
      }),
      ...(diagnostic.targetId === undefined ? {} : { targetId: diagnostic.targetId }),
      ...(diagnostic.artifactId === undefined ? {} : { artifactId: diagnostic.artifactId }),
      ...(diagnostic.generated === undefined ? {} : { generated: structuredClone(diagnostic.generated) })
    };
    const key = keyFor(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(entry);
  }
  return normalized.sort((left, right) =>
    left.uri.localeCompare(right.uri) || compare(left, right)
  );
};

export const groupRavelDiagnostics = (diagnostics, options) => {
  const grouped = new Map();
  for (const diagnostic of normalizeRavelDiagnostics(diagnostics, options)) {
    const entries = grouped.get(diagnostic.uri) ?? [];
    entries.push(diagnostic);
    grouped.set(diagnostic.uri, entries);
  }
  return grouped;
};

export const publishRavelDiagnostics = (vscode, collection, diagnostics, options = {}) => {
  const grouped = groupRavelDiagnostics(diagnostics, options);
  collection.clear();
  for (const [uri, entries] of grouped) {
    const target = vscode.Uri.parse(uri);
    collection.set(target, entries.map((entry) => {
      const value = new vscode.Diagnostic(
        new vscode.Range(
          entry.range.start.line,
          entry.range.start.character,
          entry.range.end.line,
          entry.range.end.character
        ),
        entry.message,
        vscode.DiagnosticSeverity[entry.severity[0].toUpperCase() + entry.severity.slice(1)] ??
          vscode.DiagnosticSeverity.Information
      );
      value.code = entry.code;
      value.source = entry.source;
      value.relatedInformation = entry.related.map((related) =>
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(
            vscode.Uri.parse(related.uri),
            new vscode.Range(
              related.range.start.line,
              related.range.start.character,
              related.range.end.line,
              related.range.end.character
            )
          ),
          related.message
        )
      );
      return value;
    }));
  }
  return grouped;
};
