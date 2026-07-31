const exactMappingKinds = new Set(["exact", "identity"]);

export const isExactAuthoredRange = (value, sourceUri) => Boolean(
  value &&
  value.generatedOnly !== true &&
  exactMappingKinds.has(value.mappingKind) &&
  typeof value.sourceUri === "string" &&
  value.sourceUri === sourceUri
);

export const isSafePrimaryCompletion = (entry, sourceUri) => {
  if (!entry || entry.hasAction === true || entry.generatedOnly === true) return false;
  return !entry.replacementSpan || isExactAuthoredRange(entry, sourceUri);
};
