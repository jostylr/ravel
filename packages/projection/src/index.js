export {
  createProjectionId,
  createVirtualUri,
  buildVirtualDocument,
  projectionInputHash
} from "./builder.js";

export {
  createLineIndex,
  positionAt,
  offsetAt,
  lineRangeAt,
  lineWindow
} from "./line-index.js";

export {
  buildProjectionIndexes,
  coalesceProjectionSegments,
  mapVirtualOffset,
  mapVirtualRange,
  mapSourceOffset,
  mapSourceRange,
  validateProjectionSegments,
  sameProjectionMapping
} from "./mapping.js";

export {
  generatedContext,
  navigateGeneratedSelection
} from "./context.js";

export {
  ProjectionService,
  createProjectionService,
  createProjectionTextChange
} from "./service.js";

export {
  identityTransformMap,
  createIndentOffsetMap,
  createDedentOffsetMap,
  createEolOffsetMap,
  validateTransformMapping,
  composeOffsetMaps,
  mapTransformOffset,
  opaqueTransformMap,
  normalizeSourceMap,
  applyTransformMap,
  stageCapabilities,
  validateAnalysisTransform
} from "./transforms.js";

export const MAPPING_KINDS = Object.freeze([
  "exact",
  "anchored",
  "transformed",
  "opaque",
  "synthetic"
]);

export const PROJECTION_STAGES = Object.freeze([
  "authoring",
  "assembled",
  "transformed",
  "emitted"
]);

export const POSITION_ENCODINGS = Object.freeze(["utf-8", "utf-16", "utf-32"]);
