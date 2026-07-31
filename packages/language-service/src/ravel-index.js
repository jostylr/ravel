const comparePosition = (left, right) =>
  (left?.line ?? 0) - (right?.line ?? 0) ||
  (left?.column ?? 0) - (right?.column ?? 0) ||
  (left?.offset ?? 0) - (right?.offset ?? 0);

const containsPosition = (range, position) =>
  range && comparePosition(range.start, position) <= 0 &&
  comparePosition(position, range.end) < 0;

const rangeSize = (range) => Number.isInteger(range?.start?.offset) &&
  Number.isInteger(range?.end?.offset)
  ? range.end.offset - range.start.offset
  : ((range?.end?.line ?? 0) - (range?.start?.line ?? 0)) * 1_000_000 +
    (range?.end?.column ?? 0) - (range?.start?.column ?? 0);

const safelyDecodedUri = (value) => {
  const text = String(value);
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const sameUri = (left, right) => left === right ||
  safelyDecodedUri(left) === safelyDecodedUri(right);

const contains = (source, uri, position) =>
  source?.range && sameUri(source.uri, uri) && containsPosition(source.range, position);

const identityLabel = (chunk) => chunk?.identity?.chunk ?? chunk?.name ?? chunk?.id;

const chunkSymbol = (chunk) => ({
  id: chunk.id,
  name: chunk.name ?? identityLabel(chunk),
  detail: chunk.id,
  kind: "piece",
  uri: chunk.source?.uri,
  range: chunk.source?.range,
  selectionRange: chunk.source?.range,
  language: chunk.metadata?.language,
  generated: chunk.generated === true,
  dependencies: [...(chunk.dependencies ?? [])]
});

const directiveSymbol = (directive, index) => ({
  id: "directive:" + index + ":" + directive.kind,
  name: directive.name ?? directive.kind,
  detail: directive.kind,
  kind: "directive",
  uri: directive.source?.uri,
  range: directive.source?.range,
  selectionRange: directive.source?.range
});

const diagnosticSymbol = (diagnostic, index) => ({
  id: "diagnostic:" + index + ":" + diagnostic.code,
  name: diagnostic.message,
  detail: diagnostic.code,
  kind: "diagnostic",
  uri: diagnostic.source?.uri,
  range: diagnostic.source?.range,
  selectionRange: diagnostic.source?.range
});

const sortLocations = (left, right) =>
  String(left.uri).localeCompare(String(right.uri)) ||
  comparePosition(left.range?.start, right.range?.start) ||
  comparePosition(left.range?.end, right.range?.end) ||
  String(left.id).localeCompare(String(right.id));

const sourceLocation = (source) => source?.uri && source?.range
  ? { uri: source.uri, range: source.range }
  : null;

/**
 * Build a deterministic, editor-neutral index for Ravel's own semantic
 * constructs. It intentionally consumes the complete program rather than a
 * bounded Explorer snapshot.
 */
export const createRavelSemanticIndex = (context) => {
  const program = context?.program ?? context;
  const pretransform = context?.pretransform;
  if (!program?.chunks || typeof program.chunks !== "object") {
    throw new TypeError("createRavelSemanticIndex requires a RavelProgram or Explorer-like context.");
  }
  const chunks = Object.values(program.chunks).slice().sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const references = [];
  for (const owner of chunks) {
    for (let index = 0; index < (owner.references ?? []).length; index += 1) {
      const reference = owner.references[index];
      references.push(Object.freeze({
        id: "reference:" + owner.id + ":" + index,
        kind: "reference",
        ownerId: owner.id,
        targetId: reference.chunk,
        requested: reference.requested,
        source: reference.source
      }));
    }
  }
  references.sort((left, right) => sortLocations(
    { ...left.source, id: left.id },
    { ...right.source, id: right.id }
  ));
  const directives = [...(pretransform?.directives ?? [])];
  const symbols = [
    ...chunks.map(chunkSymbol),
    ...directives.map(directiveSymbol)
  ].filter(({ uri, range }) => uri && range).sort(sortLocations);
  const diagnostics = [...(program.diagnostics ?? [])];

  const entityAt = (uri, position) => {
    const candidates = [
      ...references.filter(({ source }) => contains(source, uri, position)).map((entry) => ({
        entity: entry,
        source: entry.source,
        priority: 0
      })),
      ...chunks.filter(({ source }) => contains(source, uri, position)).map((entry) => ({
        entity: { id: entry.id, kind: "piece", source: entry.source },
        source: entry.source,
        priority: 1
      })),
      ...directives.map((entry, index) => ({
        entity: { id: "directive:" + index + ":" + entry.kind, kind: "directive", directive: entry, source: entry.source },
        source: entry.source,
        priority: 2
      })).filter(({ source }) => contains(source, uri, position)),
      ...diagnostics.map((entry, index) => ({
        entity: { ...diagnosticSymbol(entry, index), source: entry.source, diagnostic: entry },
        source: entry.source,
        priority: 3
      })).filter(({ source }) => contains(source, uri, position))
    ];
    candidates.sort((left, right) =>
      rangeSize(left.source.range) - rangeSize(right.source.range) ||
      left.priority - right.priority ||
      left.entity.id.localeCompare(right.entity.id)
    );
    return candidates[0]?.entity ?? null;
  };

  const definitionAt = (uri, position) => {
    const entity = entityAt(uri, position);
    if (entity?.kind !== "reference") return null;
    const target = chunkById.get(entity.targetId);
    const location = sourceLocation(target?.source);
    return location ? { ...location, id: target.id, kind: "piece" } : null;
  };

  const referencesFor = (id, { includeDeclaration = false } = {}) => {
    const locations = references
      .filter(({ targetId }) => targetId === id)
      .map((reference) => ({
        ...sourceLocation(reference.source),
        id: reference.id,
        kind: "reference",
        ownerId: reference.ownerId,
        targetId: reference.targetId
      }))
      .filter(({ uri, range }) => uri && range);
    const definition = chunkById.get(id);
    const declaration = sourceLocation(definition?.source);
    if (includeDeclaration && declaration) {
      locations.unshift({ ...declaration, id, kind: "piece", declaration: true });
    }
    return locations.sort(sortLocations);
  };

  const hoverAt = (uri, position) => {
    const entity = entityAt(uri, position);
    if (!entity) return null;
    const id = entity.kind === "reference" ? entity.targetId : entity.id;
    const chunk = chunkById.get(id);
    if (chunk) {
      return {
        kind: entity.kind,
        range: entity.source?.range ?? chunk.source?.range,
        contents: {
          title: chunk.name ?? identityLabel(chunk),
          canonicalId: chunk.id,
          language: chunk.metadata?.language,
          dependencies: [...(chunk.dependencies ?? [])],
          dependents: chunks.filter(({ dependencies }) => dependencies?.includes(chunk.id)).map(({ id: owner }) => owner),
          generated: chunk.generated === true,
          referenceCount: references.filter(({ targetId }) => targetId === chunk.id).length
        }
      };
    }
    if (entity.kind === "directive") {
      return {
        kind: "directive",
        range: entity.source?.range,
        contents: {
          title: entity.directive.kind,
          directive: structuredClone(entity.directive)
        }
      };
    }
    return entity.diagnostic
      ? { kind: "diagnostic", range: entity.source?.range, contents: entity.diagnostic }
      : null;
  };

  const completeReferences = (query = "", options = {}) => {
    const needle = query.toLocaleLowerCase();
    return chunks
      .filter((chunk) => options.documentId === undefined ||
        chunk.identity?.document === options.documentId)
      .filter((chunk) => !needle ||
        chunk.id.toLocaleLowerCase().includes(needle) ||
        String(chunk.name ?? "").toLocaleLowerCase().includes(needle))
      .map((chunk) => ({
        label: chunk.id,
        detail: chunk.name ?? identityLabel(chunk),
        kind: "piece",
        language: chunk.metadata?.language,
        insertText: chunk.id
      }));
  };

  const documentSymbols = (uri) => symbols.filter((symbol) => sameUri(symbol.uri, uri));

  return Object.freeze({
    revision: context?.revision,
    chunks: Object.freeze(chunks),
    references: Object.freeze(references),
    directives: Object.freeze(directives),
    diagnostics: Object.freeze(diagnostics),
    symbols: Object.freeze(symbols),
    entityAt,
    definitionAt,
    referencesFor,
    hoverAt,
    completeReferences,
    documentSymbols,
    workspaceSymbols(query = "") {
      const needle = query.toLocaleLowerCase();
      return symbols.filter(({ name, detail }) =>
        !needle || name.toLocaleLowerCase().includes(needle) ||
        String(detail).toLocaleLowerCase().includes(needle)
      );
    },
    diagnosticsFor(uri) {
      return diagnostics.filter(({ source }) => sameUri(source?.uri, uri));
    }
  });
};
