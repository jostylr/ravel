const point = (offset) => ({ line: 0, column: offset, offset });
const source = (offset = 0) => ({
  uri: "fixtures/conformance/case.ravel-map.json",
  range: { start: point(offset), end: point(offset + 1) }
});

const identity = (chunk) => ({ document: "case", chunk, minor: null, type: "text" });

export const portableConformanceFixtures = Object.freeze({
  validMap: {
    version: 1,
    document: { id: "case", uri: "fixtures/conformance/case.ravel-map.json", format: "ravel-map-v1" },
    chunks: [],
    directives: []
  },
  invalidMap: {
    version: 2,
    document: { id: "case", uri: "fixtures/conformance/case.ravel-map.json", format: "ravel-map-v1" },
    chunks: [],
    directives: []
  },
  chunkBody: "before _\"helper.text | trim()\" after",
  graphMap: {
    version: 1,
    document: { id: "case", uri: "fixtures/conformance/case.ravel-map.json", format: "ravel-map-v1" },
    chunks: [
      { id: "case::helper.text", identity: identity("helper"), body: " value ", source: source(0) },
      { id: "case::main.text", identity: identity("main"), body: "_\"helper.text | trim()\"", source: source(16) }
    ],
    directives: [{ kind: "out", name: "dist/result.txt", from: "case::main.text", source: source(48) }]
  }
});

export const portableConformanceFailures = ({
  validateRavelMap,
  parseChunk,
  combineMaps,
  transformGraph,
  createDeliverableProvenanceMap
}) => {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };

  expect(validateRavelMap(portableConformanceFixtures.validMap).length === 0, "valid map");
  expect(validateRavelMap(portableConformanceFixtures.invalidMap).some(({ code, message }) => code === "RM200" && /version must be 1/.test(message)), "invalid map diagnostic");

  const parsed = parseChunk(portableConformanceFixtures.chunkBody, source(80));
  expect(parsed.diagnostics.length === 0 && parsed.nodes.length === 3 && parsed.nodes[1]?.type === "reference", "chunk syntax");

  const first = transformGraph(combineMaps([portableConformanceFixtures.graphMap]));
  const second = transformGraph(combineMaps([portableConformanceFixtures.graphMap]));
  expect(first.diagnostics.length === 0, "graph diagnostics");
  expect(first.deliverables["dist/result.txt"]?.value === "value", "graph evaluation");

  const firstMap = createDeliverableProvenanceMap(first.deliverables["dist/result.txt"]);
  const secondMap = createDeliverableProvenanceMap(second.deliverables["dist/result.txt"]);
  expect(firstMap.segments.some(({ precision }) => precision === "exact"), "provenance segments");
  expect(JSON.stringify(firstMap) === JSON.stringify(secondMap), "deterministic serialization");
  return failures;
};
