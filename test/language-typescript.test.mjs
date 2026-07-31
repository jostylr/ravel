import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTypeScriptLanguageBridge,
  createTypeScriptLanguageBridgeWithApi
} from "../packages/language-typescript/src/index.js";
import { resolveConfigPath } from "../packages/language-typescript/src/typescript-project.js";
import { BRIDGE_ERROR_CODES } from "../packages/language-bridge/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..");

const virtualDocument = ({ name = "main.ts", uri = "pieceful-virtual://test/main", version = 1, languageId = "typescript", text }) => ({
  id: "projection:" + name,
  uri,
  version,
  stage: "assembled",
  languageId,
  fileName: path.join(repositoryRoot, "fixtures/virtual-documents/typescript/src", name),
  tsconfigPath: path.join(repositoryRoot, "fixtures/virtual-documents/typescript/tsconfig.json"),
  text
});

const createFakeTypeScript = () => {
  const hosts = [];
  let servicesCreated = 0;
  const ts = {
    ScriptTarget: { ES2020: 7, ES2022: 9 },
    ModuleKind: { ESNext: 99 },
    ModuleResolutionKind: { NodeJs: 2, Node10: 2, Bundler: 100 },
    JsxEmit: { Preserve: 1 },
    ScriptKind: { Unknown: 0, JS: 1, JSX: 2, TS: 3, TSX: 4 },
    DiagnosticCategory: { Warning: 0, Error: 1, Suggestion: 2, Message: 3 },
    ScriptSnapshot: { fromString: (text) => ({ text, getLength: () => text.length, getText: (start, end) => text.slice(start, end) }) },
    sys: {
      args: [],
      newLine: "\n",
      useCaseSensitiveFileNames: true,
      getCurrentDirectory: () => repositoryRoot,
      fileExists: () => false,
      readFile: () => undefined,
      readDirectory: () => [],
      directoryExists: () => true,
      getDirectories: () => []
    },
    getDefaultLibFilePath: () => "/virtual/lib.d.ts",
    getScriptKindFromFileName: (fileName) => fileName.endsWith(".tsx") ? 4 : fileName.endsWith(".jsx") ? 2 : fileName.endsWith(".js") ? 1 : 3,
    createDocumentRegistry: () => ({}),
    flattenDiagnosticMessageText: (message) => typeof message === "string" ? message : message.messageText,
    createLanguageService(host) {
      hosts.push(host);
      servicesCreated += 1;
      const currentFile = () => host.getScriptFileNames().at(-1);
      return {
        dispose() {},
        getCompletionsAtPosition: () => ({
          isMemberCompletion: true,
          entries: [{ name: "member", kind: "property", kindModifiers: "", sortText: "11", hasAction: false }]
        }),
        getCompletionEntryDetails: () => ({
          name: "member",
          kind: "property",
          kindModifiers: "",
          displayParts: [{ text: "(property) member: string" }],
          documentation: [{ text: "A member." }],
          codeActions: [{
            description: "Add import",
            changes: [{ fileName: currentFile(), textChanges: [{ span: { start: 0, length: 0 }, newText: "import {};\n" }] }]
          }]
        }),
        getQuickInfoAtPosition: () => ({
          kind: "const",
          kindModifiers: "",
          textSpan: { start: 0, length: 5 },
          displayParts: [{ text: "const value: number" }],
          documentation: []
        }),
        getSignatureHelpItems: () => ({
          applicableSpan: { start: 1, length: 2 },
          selectedItemIndex: 0,
          argumentIndex: 0,
          argumentCount: 1,
          items: [{
            isVariadic: false,
            prefixDisplayParts: [{ text: "fn(" }],
            separatorDisplayParts: [{ text: ", " }],
            suffixDisplayParts: [{ text: "): void" }],
            documentation: [],
            parameters: [{ name: "value", displayParts: [{ text: "value: number" }], documentation: [], isOptional: false }]
          }]
        }),
        getDefinitionAtPosition: () => [{ fileName: currentFile(), textSpan: { start: 6, length: 5 }, name: "value", kind: "const" }],
        getTypeDefinitionAtPosition: () => [{ fileName: currentFile(), textSpan: { start: 6, length: 5 }, name: "number", kind: "keyword" }],
        getReferencesAtPosition: () => [{ fileName: currentFile(), textSpan: { start: 6, length: 5 }, isWriteAccess: true, isDefinition: true }],
        getNavigationTree: () => ({ text: "main", kind: "module", spans: [{ start: 0, length: 16 }], childItems: [{ text: "value", kind: "const", spans: [{ start: 6, length: 5 }] }] }),
        getNavigateToItems: () => [{ name: "value", kind: "const", kindModifiers: "", fileName: currentFile(), textSpan: { start: 6, length: 5 }, matchKind: "exact" }],
        getCompilerOptionsDiagnostics: () => [],
        getSyntacticDiagnostics: () => [],
        getSemanticDiagnostics: () => [{ file: { fileName: currentFile() }, start: 6, length: 5, code: 9999, category: 1, messageText: "Fake semantic error." }],
        getSuggestionDiagnostics: () => [],
        prepareCallHierarchy: () => ({ name: "fn", kind: "function", file: currentFile(), span: { start: 0, length: 12 }, selectionSpan: { start: 0, length: 2 } }),
        provideCallHierarchyIncomingCalls: () => [{ from: { name: "caller", kind: "function", file: currentFile(), span: { start: 0, length: 12 }, selectionSpan: { start: 3, length: 6 } }, fromSpans: [{ start: 3, length: 2 }] }],
        provideCallHierarchyOutgoingCalls: () => [{ to: { name: "callee", kind: "function", file: currentFile(), span: { start: 0, length: 12 }, selectionSpan: { start: 3, length: 6 } }, fromSpans: [{ start: 8, length: 2 }] }],
        getRenameInfo: () => ({ canRename: true, triggerSpan: { start: 6, length: 5 }, displayName: "value", fullDisplayName: "value", kind: "const", kindModifiers: "" }),
        findRenameLocations: () => [{ fileName: currentFile(), textSpan: { start: 6, length: 5 } }]
      };
    }
  };
  return { ts, hosts, get servicesCreated() { return servicesCreated; } };
};

test("TypeScript config lookup stays within its canonical search root", () => {
  const root = path.join(repositoryRoot, "workspace");
  const nested = path.join(root, "src", "feature");
  const insideConfig = path.join(root, "tsconfig.json");
  const outsideConfig = path.join(repositoryRoot, "tsconfig.json");
  const symlinkConfig = path.join(root, "linked", "tsconfig.json");
  const existing = new Set([insideConfig, outsideConfig, symlinkConfig]);
  const ts = {
    sys: {
      useCaseSensitiveFileNames: true,
      fileExists: (fileName) => existing.has(path.normalize(fileName)),
      directoryExists: (directory) => [
        root,
        path.join(root, "src"),
        nested,
        path.join(root, "linked"),
        repositoryRoot
      ].includes(path.normalize(directory)),
      realpath: (fileName) => {
        const normalized = path.normalize(fileName);
        const linked = path.normalize(path.join(root, "linked"));
        return normalized === linked || normalized.startsWith(linked + path.sep)
          ? path.join(repositoryRoot, "outside-linked", path.relative(linked, normalized))
          : normalized;
      }
    }
  };
  const options = { currentDirectory: root, configSearchRoot: root };
  const fileName = path.join(nested, "main.ts");

  assert.equal(resolveConfigPath(ts, {}, fileName, options), insideConfig);
  assert.equal(resolveConfigPath(ts, { tsconfigPath: outsideConfig }, fileName, options), insideConfig);
  assert.equal(resolveConfigPath(ts, { tsconfigPath: symlinkConfig }, fileName, options), insideConfig);
  assert.equal(resolveConfigPath(ts, { tsconfigPath: insideConfig }, fileName, options), insideConfig);
  assert.equal(resolveConfigPath(ts, {}, path.join(repositoryRoot, "outside", "main.ts"), options), undefined);

  existing.delete(insideConfig);
  assert.equal(resolveConfigPath(ts, {}, fileName, options), undefined);
  assert.equal(resolveConfigPath(ts, { tsconfigPath: outsideConfig }, fileName, options), undefined);
  assert.equal(resolveConfigPath(ts, { tsconfigPath: symlinkConfig }, fileName, options), undefined);
});

test("TypeScript bridge defaults configSearchRoot to currentDirectory", async () => {
  const fake = createFakeTypeScript();
  const root = path.join(repositoryRoot, "fixtures", "virtual-documents", "typescript");
  const bridge = createTypeScriptLanguageBridgeWithApi(fake.ts, { currentDirectory: root });
  assert.equal(bridge.options.configSearchRoot, root);
  await bridge.dispose();
});

test("TypeScript bridge resolves a relative configSearchRoot from currentDirectory", async () => {
  const fake = createFakeTypeScript();
  const currentDirectory = path.join(repositoryRoot, "fixtures", "virtual-documents", "typescript", "src");
  const bridge = createTypeScriptLanguageBridgeWithApi(fake.ts, {
    currentDirectory,
    configSearchRoot: ".."
  });
  assert.equal(
    bridge.options.configSearchRoot,
    path.join(repositoryRoot, "fixtures", "virtual-documents", "typescript")
  );
  await bridge.dispose();
});

test("TypeScript bridge is injectable and normalizes native feature responses", async () => {
  const fake = createFakeTypeScript();
  const bridge = createTypeScriptLanguageBridgeWithApi(fake.ts, { currentDirectory: repositoryRoot });
  const source = { ...virtualDocument({ text: "const value = 1;" }), tsconfigPath: undefined };
  await bridge.open(source);

  assert.equal((await bridge.request({ kind: "completion", documentUri: source.uri, position: 12 }, { version: 1 })).items[0].name, "member");
  const details = await bridge.request({ kind: "completionDetails", documentUri: source.uri, position: 12, name: "member" }, { version: 1 });
  assert.equal(details.codeActions[0].changes[0].uri, source.uri);
  assert.equal(details.codeActions[0].changes[0].version, 1);
  assert.deepEqual(details.codeActions[0].changes[0].textChanges[0], { range: { start: 0, end: 0 }, text: "import {};\n" });
  assert.equal((await bridge.request({ kind: "hover", documentUri: source.uri, position: 7 }, { version: 1 })).display, "const value: number");
  assert.equal((await bridge.request({ kind: "signatureHelp", documentUri: source.uri, position: 7 }, { version: 1 })).items[0].parameters[0].name, "value");
  assert.equal((await bridge.request({ kind: "definition", documentUri: source.uri, position: 7 }, { version: 1 }))[0].uri, source.uri);
  assert.equal((await bridge.request({ kind: "typeDefinition", documentUri: source.uri, position: 7 }, { version: 1 }))[0].range.start, 6);
  assert.equal((await bridge.request({ kind: "references", documentUri: source.uri, position: 7 }, { version: 1 }))[0].isWriteAccess, true);
  assert.ok((await bridge.request({ kind: "documentSymbols", documentUri: source.uri }, { version: 1 })).some((symbol) => symbol.name === "value"));
  assert.equal((await bridge.request({ kind: "workspaceSymbols", documentUri: source.uri, query: "value" }, { version: 1 }))[0].name, "value");
  assert.equal((await bridge.request({ kind: "diagnostics", documentUri: source.uri }, { version: 1 }))[0].code, 9999);
  assert.equal((await bridge.request({ kind: "prepareCallHierarchy", documentUri: source.uri, position: 1 }, { version: 1 }))[0].name, "fn");
  assert.equal((await bridge.request({ kind: "incomingCalls", documentUri: source.uri, position: 1 }, { version: 1 }))[0].from.name, "caller");
  assert.equal((await bridge.request({ kind: "outgoingCalls", documentUri: source.uri, position: 1 }, { version: 1 }))[0].to.name, "callee");
  assert.equal((await bridge.request({ kind: "prepareRename", documentUri: source.uri, position: 7 }, { version: 1 })).canRename, true);
  const rename = await bridge.request({ kind: "rename", documentUri: source.uri, position: 7, newName: "answer" }, { version: 1 });
  assert.equal(rename.changes[0].version, 1);
  assert.equal(rename.changes[0].textChanges[0].text, "answer");

  const changed = { ...source, version: 2, text: "const value = 2;" };
  await bridge.change(source, changed, [{ range: { start: 14, end: 15 }, text: "2" }]);
  assert.match(fake.hosts[0].getScriptVersion(source.fileName), /^2:r\d+$/);
  assert.equal(fake.hosts[0].getScriptSnapshot(source.fileName).text, changed.text);
  await assert.rejects(
    bridge.request({ kind: "hover", documentUri: source.uri, position: 7 }, { version: 1 }),
    (error) => error.code === BRIDGE_ERROR_CODES.STALE_DOCUMENT
  );

  await bridge.restart();
  assert.equal(fake.servicesCreated, 2);
  assert.equal((await bridge.request({ kind: "hover", documentUri: source.uri, position: 7 }, { version: 2 })).display, "const value: number");
  await bridge.dispose();
});

test("TypeScript bridge cancellation preserves open and change commit coherence", async () => {
  const fake = createFakeTypeScript();
  const bridge = createTypeScriptLanguageBridgeWithApi(fake.ts, { currentDirectory: repositoryRoot });
  const source = { ...virtualDocument({ text: "const value = 1;" }), tsconfigPath: undefined };
  let abortBeforeCommit;
  let abortAfterAdd;

  const originalCreateEntry = bridge.createEntry.bind(bridge);
  bridge.createEntry = (document) => {
    const entry = originalCreateEntry(document);
    const controller = abortBeforeCommit;
    abortBeforeCommit = undefined;
    controller?.abort(new Error("cancel before commit"));
    return entry;
  };

  const originalEnsureProject = bridge.ensureProject.bind(bridge);
  const patchedProjects = new WeakSet();
  bridge.ensureProject = (...args) => {
    const project = originalEnsureProject(...args);
    if (!patchedProjects.has(project)) {
      patchedProjects.add(project);
      const originalAdd = project.add.bind(project);
      project.add = (entry) => {
        originalAdd(entry);
        const controller = abortAfterAdd;
        abortAfterAdd = undefined;
        controller?.abort(new Error("cancel after add"));
      };
    }
    return project;
  };

  try {
    const cancelledOpen = new AbortController();
    abortBeforeCommit = cancelledOpen;
    await assert.rejects(
      bridge.open(source, cancelledOpen.signal),
      (error) => error.code === BRIDGE_ERROR_CODES.ABORTED
    );
    assert.equal(bridge.documents.has(source.uri), false);
    assert.equal([...bridge.projects.values()][0].documents.size, 0);

    const committedOpen = new AbortController();
    abortAfterAdd = committedOpen;
    await bridge.open(source, committedOpen.signal);
    assert.equal(committedOpen.signal.aborted, true);
    assert.equal(
      (await bridge.request({ kind: "hover", documentUri: source.uri, position: 7 }, { version: 1 })).display,
      "const value: number"
    );

    const changed = { ...source, version: 2, text: "const value = 2;" };
    const committedChange = new AbortController();
    abortAfterAdd = committedChange;
    await bridge.change(source, changed, [{ range: { start: 14, end: 15 }, text: "2" }], committedChange.signal);
    assert.equal(committedChange.signal.aborted, true);
    assert.equal(fake.hosts[0].getScriptSnapshot(source.fileName).text, changed.text);
    assert.equal(
      (await bridge.request({ kind: "hover", documentUri: source.uri, position: 7 }, { version: 2 })).display,
      "const value: number"
    );

    const changedAgain = { ...changed, version: 3, text: "const value = 3;" };
    await bridge.change(changed, changedAgain, [{ range: { start: 14, end: 15 }, text: "3" }]);
    assert.equal(fake.hosts[0].getScriptSnapshot(source.fileName).text, changedAgain.text);
    assert.equal(
      (await bridge.request({ kind: "hover", documentUri: source.uri, position: 7 }, { version: 3 })).display,
      "const value: number"
    );
  } finally {
    await bridge.dispose();
  }
});

test("async TypeScript bridge factory reports a missing optional runtime", async () => {
  await assert.rejects(
    createTypeScriptLanguageBridge({ loadTypeScript: async () => { throw new Error("missing"); } }),
    (error) => error.code === "TYPESCRIPT_NOT_AVAILABLE" && /optional `typescript` peer dependency/.test(error.message)
  );
});

test("TypeScript bridge accepts TS, JS, TSX, and JSX virtual documents", async () => {
  const fake = createFakeTypeScript();
  const bridge = createTypeScriptLanguageBridgeWithApi(fake.ts, { currentDirectory: repositoryRoot });
  const variants = [
    ["typescript", "variant.ts", 3],
    ["javascript", "variant.js", 1],
    ["typescriptreact", "variant.tsx", 4],
    ["javascriptreact", "variant.jsx", 2]
  ];
  for (const [languageId, name] of variants) {
    await bridge.open({
      ...virtualDocument({ name, uri: "pieceful-virtual://test/" + languageId, languageId, text: "const value = 1;" }),
      tsconfigPath: undefined
    });
  }
  const host = fake.hosts[0];
  for (const [_languageId, name, expectedKind] of variants) {
    assert.equal(host.getScriptKind(path.join(repositoryRoot, "fixtures/virtual-documents/typescript/src", name)), expectedKind);
  }
  const unsafe = {
    ...virtualDocument({ name: "ignored.ts", uri: "pieceful-virtual://test/unsafe", text: "const safe = true;" }),
    fileName: undefined,
    tsconfigPath: undefined,
    artifactId: "../outside.ts"
  };
  await bridge.open(unsafe);
  const unsafeFileName = host.getScriptFileNames().find((fileName) => fileName.includes(".ravel-virtual"));
  assert.ok(unsafeFileName?.startsWith(path.join(repositoryRoot, ".ravel-virtual") + path.sep));
  await bridge.dispose();
});

const loadNativeTypeScript = () => {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.RAVEL_TYPESCRIPT_PATH,
    "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/node_modules/typescript/lib/typescript.js",
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions/node_modules/typescript/lib/typescript.js"
  ].filter(Boolean);
  try {
    candidates.unshift(require.resolve("typescript"));
  } catch {
    // The integration test can use an editor-bundled runtime or skip cleanly.
  }
  for (const candidate of candidates) {
    try {
      return { typescript: require(candidate), source: candidate };
    } catch {
      // Try the next explicitly allowlisted TypeScript runtime.
    }
  }
  return undefined;
};

const native = loadNativeTypeScript();

test("native TypeScript projects isolate and switch projection stages", { skip: native ? false : "TypeScript runtime is not installed" }, async () => {
  const bridge = createTypeScriptLanguageBridgeWithApi(native.typescript, { currentDirectory: repositoryRoot });
  const artifactId = "fixtures/virtual-documents/typescript/src/stage-identity.ts";
  const targetId = "stage-identity-target";
  const authoring = {
    ...virtualDocument({
      name: "stage-identity.ts",
      uri: "pieceful-virtual://test/stage/authoring",
      text: "export const stageValue = \"authoring\" as const;\n"
    }),
    id: "projection:stage-identity:authoring",
    fileName: undefined,
    artifactId,
    targetId,
    stage: "authoring"
  };
  const assembled = {
    ...virtualDocument({
      name: "stage-identity.ts",
      uri: "pieceful-virtual://test/stage/assembled",
      text: "export const stageValue = 42 as const;\n"
    }),
    id: "projection:stage-identity:assembled",
    fileName: undefined,
    artifactId,
    targetId,
    stage: "assembled"
  };
  const hoverPosition = authoring.text.indexOf("stageValue") + 1;

  try {
    await bridge.open(authoring);
    await bridge.open(assembled);

    const authoringHover = await bridge.request({
      kind: "hover",
      documentUri: authoring.uri,
      position: hoverPosition
    }, { version: 1 });
    const assembledHover = await bridge.request({
      kind: "hover",
      documentUri: assembled.uri,
      position: hoverPosition
    }, { version: 1 });
    assert.match(authoringHover.display, /\"authoring\"/);
    assert.match(assembledHover.display, /42/);

    await bridge.close(authoring);
    const switched = {
      ...assembled,
      version: 2,
      stage: "authoring",
      text: "export const stageValue = \"switched\" as const;\n"
    };
    await bridge.change(assembled, switched, [{
      range: { start: 0, end: assembled.text.length },
      text: switched.text
    }]);

    const replacementAssembled = {
      ...assembled,
      id: "projection:stage-identity:assembled-replacement",
      uri: "pieceful-virtual://test/stage/assembled-replacement",
      text: "export const stageValue = 99 as const;\n"
    };
    await bridge.open(replacementAssembled);

    const switchedHover = await bridge.request({
      kind: "hover",
      documentUri: switched.uri,
      position: hoverPosition
    }, { version: 2 });
    const replacementHover = await bridge.request({
      kind: "hover",
      documentUri: replacementAssembled.uri,
      position: hoverPosition
    }, { version: 1 });
    assert.match(switchedHover.display, /\"switched\"/);
    assert.match(replacementHover.display, /99/);

    await bridge.close(replacementAssembled);
    const secondReplacement = {
      ...replacementAssembled,
      id: "projection:stage-identity:assembled-second-replacement",
      uri: "pieceful-virtual://test/stage/assembled-second-replacement",
      text: "export const stageValue = 123 as const;\n"
    };
    await bridge.open(secondReplacement);
    const secondReplacementHover = await bridge.request({
      kind: "hover",
      documentUri: secondReplacement.uri,
      position: hoverPosition
    }, { version: 1 });
    assert.match(secondReplacementHover.display, /123/);
  } finally {
    await bridge.dispose();
  }
});

test("native TypeScript project sees in-memory modules and unsaved updates", { skip: native ? false : "TypeScript runtime is not installed" }, async () => {
  const bridge = createTypeScriptLanguageBridgeWithApi(native.typescript, { currentDirectory: repositoryRoot });
  const modelText = [
    "export interface Person { name: string; age: number }",
    "export function greet(person: Person, prefix = \"Hello\"): string {",
    "  return `${prefix}, ${person.name}`;",
    "}",
    "export function caller(person: Person): string {",
    "  return greet(person);",
    "}",
    ""
  ].join("\n");
  const mainText = [
    "import { Person, greet } from \"./model\";",
    "const ada: Person = { name: \"Ada\", age: 36 };",
    "ada.name;",
    "greet(ada, );",
    ""
  ].join("\n");
  const model = {
    ...virtualDocument({ name: "model.ts", uri: "pieceful-virtual://test/model", text: modelText }),
    fileName: undefined,
    artifactId: "fixtures/virtual-documents/typescript/src/model.ts"
  };
  const main = {
    ...virtualDocument({ name: "main.ts", uri: "pieceful-virtual://test/main", text: mainText }),
    fileName: undefined,
    artifactId: "fixtures/virtual-documents/typescript/src/main.ts"
  };
  await bridge.open(main);
  const beforeDependency = await bridge.request({
    kind: "diagnostics",
    documentUri: main.uri,
    categories: ["semantic"]
  }, { version: 1 });
  assert.ok(beforeDependency.some((entry) => entry.code === 2307));
  await bridge.open(model);
  const afterDependency = await bridge.request({
    kind: "diagnostics",
    documentUri: main.uri,
    categories: ["semantic"]
  }, { version: 1 });
  assert.equal(afterDependency.some((entry) => entry.code === 2307), false);
  const configuredDiagnostics = await bridge.request({
    kind: "diagnostics",
    documentUri: main.uri,
    categories: ["configuration"]
  }, { version: 1 });
  assert.equal(configuredDiagnostics.some((entry) => entry.code === 18003), false);

  const aliasText = [
    "import type { Person } from \"@fixture/model\";",
    "export const grace: Person = { name: \"Grace\", age: 37 };",
    ""
  ].join("\n");
  const alias = virtualDocument({ name: "alias.ts", uri: "pieceful-virtual://test/alias", text: aliasText });
  await bridge.open(alias);
  const aliasDiagnostics = await bridge.request({
    kind: "diagnostics",
    documentUri: alias.uri,
    categories: ["syntactic", "semantic"]
  }, { version: 1 });
  assert.equal(aliasDiagnostics.some((entry) => entry.code === 2307), false);

  const tsxText = [
    "declare namespace JSX {",
    "  interface IntrinsicElements { div: { title?: string } }",
    "}",
    "export const view = <div title=\"Ravel\" />;",
    ""
  ].join("\n");
  const tsx = virtualDocument({
    name: "view.tsx",
    uri: "pieceful-virtual://test/view",
    languageId: "typescriptreact",
    text: tsxText
  });
  await bridge.open(tsx);
  const tsxDiagnostics = await bridge.request({
    kind: "diagnostics",
    documentUri: tsx.uri,
    categories: ["syntactic", "semantic"]
  }, { version: 1 });
  assert.equal(tsxDiagnostics.some((entry) => entry.code === 17004), false);

  const sharedArtifact = "fixtures/virtual-documents/typescript/src/environment.ts";
  const browserEnvironment = {
    ...virtualDocument({
      name: "environment.ts",
      uri: "pieceful-virtual://test/browser/environment",
      text: "export const environment = \"browser\" as const;\n"
    }),
    fileName: undefined,
    artifactId: sharedArtifact,
    targetId: "browser"
  };
  const serverEnvironment = {
    ...virtualDocument({
      name: "environment.ts",
      uri: "pieceful-virtual://test/server/environment",
      text: "export const environment = 42 as const;\n"
    }),
    fileName: undefined,
    artifactId: sharedArtifact,
    targetId: "server"
  };
  await bridge.open(browserEnvironment);
  await bridge.open(serverEnvironment);
  const browserHover = await bridge.request({
    kind: "hover",
    documentUri: browserEnvironment.uri,
    position: browserEnvironment.text.indexOf("environment") + 1
  }, { version: 1 });
  const serverHover = await bridge.request({
    kind: "hover",
    documentUri: serverEnvironment.uri,
    position: serverEnvironment.text.indexOf("environment") + 1
  }, { version: 1 });
  assert.match(browserHover.display, /"browser"/);
  assert.match(serverHover.display, /42/);

  const autoImportText = "const person: Per\n";
  const autoImport = virtualDocument({
    name: "auto-import.ts",
    uri: "pieceful-virtual://test/auto-import",
    text: autoImportText
  });
  await bridge.open(autoImport);
  const autoImportPosition = autoImportText.indexOf("Per") + "Per".length;
  const autoCompletions = await bridge.request({
    kind: "completion",
    documentUri: autoImport.uri,
    position: autoImportPosition,
    options: {
      includeCompletionsForModuleExports: true,
      includeCompletionsWithInsertText: true
    }
  }, { version: 1 });
  const personCompletion = autoCompletions.items.find((item) => item.name === "Person" && item.hasAction);
  assert.ok(personCompletion);
  const personDetails = await bridge.request({
    kind: "completionDetails",
    documentUri: autoImport.uri,
    position: autoImportPosition,
    name: personCompletion.name,
    source: personCompletion.source,
    data: personCompletion.data
  }, { version: 1 });
  assert.ok(personDetails.codeActions.some((action) =>
    action.changes.some((change) => change.uri === autoImport.uri &&
      change.textChanges.some((textChange) => /import/.test(textChange.text)))));

  const completionPosition = mainText.indexOf("ada.") + "ada.".length;
  const completion = await bridge.request({ kind: "completion", documentUri: main.uri, position: completionPosition }, { version: 1 });
  assert.deepEqual(completion.items.filter((item) => item.name === "age" || item.name === "name").map((item) => item.name).sort(), ["age", "name"]);

  const personUse = mainText.indexOf("Person", mainText.indexOf("const ada"));
  const hover = await bridge.request({ kind: "hover", documentUri: main.uri, position: personUse + 1 }, { version: 1 });
  assert.match(hover.display, /Person/);

  const signaturePosition = mainText.indexOf("greet(ada, ") + "greet(ada, ".length;
  const signature = await bridge.request({ kind: "signatureHelp", documentUri: main.uri, position: signaturePosition }, { version: 1 });
  assert.equal(signature.argumentIndex, 1);
  assert.deepEqual(signature.items[0].parameters.map((parameter) => parameter.name), ["person", "prefix"]);

  const greetUse = mainText.lastIndexOf("greet");
  const definitions = await bridge.request({ kind: "definition", documentUri: main.uri, position: greetUse + 1 }, { version: 1 });
  assert.equal(definitions[0].uri, model.uri);
  const adaUse = mainText.indexOf("ada", mainText.indexOf("const ada"));
  const typeDefinitions = await bridge.request({ kind: "typeDefinition", documentUri: main.uri, position: adaUse + 1 }, { version: 1 });
  assert.equal(typeDefinitions[0].uri, model.uri);
  const references = await bridge.request({ kind: "references", documentUri: main.uri, position: greetUse + 1 }, { version: 1 });
  assert.ok(references.some((entry) => entry.uri === model.uri));
  assert.ok(references.some((entry) => entry.uri === main.uri));

  const symbols = await bridge.request({ kind: "documentSymbols", documentUri: model.uri }, { version: 1 });
  assert.ok(symbols.some((entry) => entry.name === "greet"));
  const workspaceSymbols = await bridge.request({ kind: "workspaceSymbols", documentUri: main.uri, query: "greet" }, { version: 1 });
  assert.ok(workspaceSymbols.some((entry) => entry.name === "greet" && entry.uri === model.uri));

  const greetDeclaration = modelText.indexOf("greet");
  const preparedCalls = await bridge.request({ kind: "prepareCallHierarchy", documentUri: model.uri, position: greetDeclaration + 1 }, { version: 1 });
  assert.equal(preparedCalls[0].name, "greet");
  const incoming = await bridge.request({ kind: "incomingCalls", documentUri: model.uri, position: greetDeclaration + 1 }, { version: 1 });
  assert.ok(incoming.some((entry) => entry.from.name === "caller"));
  const callerDeclaration = modelText.indexOf("caller");
  const outgoing = await bridge.request({ kind: "outgoingCalls", documentUri: model.uri, position: callerDeclaration + 1 }, { version: 1 });
  assert.ok(outgoing.some((entry) => entry.to.name === "greet"));

  const rename = await bridge.request({ kind: "rename", documentUri: model.uri, position: greetDeclaration + 1, newName: "welcome" }, { version: 1 });
  assert.equal(rename.canRename, true);
  assert.ok(rename.changes.some((entry) => entry.uri === model.uri));
  assert.ok(rename.changes.some((entry) => entry.uri === main.uri));

  const invalidMain = { ...main, version: 2, text: mainText.replace("age: 36", "age: \"old\"") };
  await bridge.change(main, invalidMain, [{
    range: { start: mainText.indexOf("36"), end: mainText.indexOf("36") + 2 },
    text: "\"old\""
  }]);
  const diagnostics = await bridge.request({
    kind: "diagnostics",
    documentUri: main.uri,
    categories: ["syntactic", "semantic"]
  }, { version: 2 });
  assert.ok(diagnostics.some((entry) => entry.severity === "error" && /string/.test(entry.message) && /number/.test(entry.message)));

  const controller = new AbortController();
  controller.abort(new Error("superseded"));
  await assert.rejects(
    bridge.request({ kind: "hover", documentUri: main.uri, position: 1 }, { version: 2 }, controller.signal),
    (error) => error.code === BRIDGE_ERROR_CODES.ABORTED
  );

  await bridge.restart();
  const afterRestart = await bridge.request({
    kind: "diagnostics",
    documentUri: main.uri,
    categories: ["syntactic", "semantic"]
  }, { version: 2 });
  assert.ok(afterRestart.some((entry) => entry.severity === "error"));
  await bridge.close(model);
  await bridge.close(invalidMain);
  await bridge.close(alias);
  await bridge.close(tsx);
  await bridge.close(autoImport);
  await bridge.close(browserEnvironment);
  await bridge.close(serverEnvironment);
  await bridge.dispose();
});
