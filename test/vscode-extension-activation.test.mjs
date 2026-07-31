import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

const vscodeStub = String.raw`
const record = (kind, value) => {
  globalThis.__ravelVscodeCalls ??= [];
  globalThis.__ravelVscodeCalls.push({ kind, value });
  return { dispose() {} };
};
export class EventEmitter {
  constructor() { this.listeners = new Set(); this.event = (listener) => {
    this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) };
  }; }
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
export class ThemeColor { constructor(id) { this.id = id; } }
export const Uri = {
  parse(value) { return { scheme: String(value).split(":")[0], fsPath: String(value), toString: () => String(value) }; },
  file(value) { return { scheme: "file", fsPath: value, toString: () => "file://" + value }; },
  joinPath(base, ...parts) { return Uri.parse(base.toString() + "/" + parts.join("/")); }
};
export const languages = {
  createDiagnosticCollection: (name) => ({ name, clear() {}, set() {}, dispose() {} }),
  setTextDocumentLanguage: async (document, languageId) => ({ ...document, languageId }),
  registerDefinitionProvider: (...args) => record("definition", args),
  registerHoverProvider: (...args) => record("hover", args),
  registerReferenceProvider: (...args) => record("references", args),
  registerCompletionItemProvider: (...args) => record("completion", args),
  registerSignatureHelpProvider: (...args) => record("signature", args),
  registerTypeDefinitionProvider: (...args) => record("type-definition", args),
  registerRenameProvider: (...args) => record("rename", args),
  registerCallHierarchyProvider: (...args) => record("call-hierarchy", args),
  registerDocumentSymbolProvider: (...args) => record("document-symbols", args),
  registerCodeLensProvider: (...args) => record("code-lens", args)
};
export const workspace = {
  textDocuments: [],
  workspaceFolders: [],
  fs: { stat: async () => ({}) },
  getWorkspaceFolder: () => undefined,
  getConfiguration: () => ({ get: () => "" }),
  registerTextDocumentContentProvider: (...args) => record("content-provider", args),
  onDidChangeTextDocument: (...args) => record("change-document", args),
  onDidOpenTextDocument: (...args) => record("open-document", args),
  onDidSaveTextDocument: (...args) => record("save-document", args),
  onDidCloseTextDocument: (...args) => record("close-document", args),
  openTextDocument: async () => { throw new Error("not used during activation"); }
};
export const window = {
  activeTextEditor: undefined,
  createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
  createTextEditorDecorationType: () => ({ dispose() {} }),
  onDidChangeTextEditorSelection: (...args) => record("selection", args),
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  setStatusBarMessage: () => ({ dispose() {} })
};
export const commands = {
  registerCommand: (name, handler) => record("command", [name, handler]),
  executeCommand: async () => undefined
};
export const StatusBarAlignment = { Left: 1 };
export const OverviewRulerLane = { Right: 4 };
export const ProgressLocation = { Notification: 1 };
export const ViewColumn = { One: 1, Beside: 2, Active: -1 };
export const TextEditorRevealType = { InCenterIfOutsideViewport: 0 };
export class Position { constructor(line, character) { this.line = line; this.character = character; } }
export class Range { constructor(...args) { this.args = args; this.start = args[0]; this.end = args[1]; } }
export class Selection extends Range {}
export class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
export class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
export class DiagnosticRelatedInformation {}
export class MarkdownString { appendMarkdown() {} appendCodeblock() {} }
export class Hover {}
export class CompletionItem {}
export class SnippetString {}
export class SignatureHelp {}
export class SignatureInformation {}
export class ParameterInformation {}
export class WorkspaceEdit { replace() {} }
export class CallHierarchyItem {}
export class CallHierarchyIncomingCall {}
export class CallHierarchyOutgoingCall {}
export class DocumentSymbol {}
export class CodeLens {}
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export const CompletionItemKind = new Proxy({}, { get: () => 0 });
export const SymbolKind = new Proxy({}, { get: () => 0 });
`;

test("VS Code extension activation registers generated and native language surfaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ravel-vscode-activation-"));
  const output = join(directory, "extension.cjs");
  globalThis.__ravelVscodeCalls = [];
  try {
    await build({
      entryPoints: [new URL("../packages/vscode/src/extension.js", import.meta.url).pathname],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      logLevel: "silent",
      plugins: [{
        name: "vscode-stub",
        setup(builder) {
          builder.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "ravel-test" }));
          builder.onLoad({ filter: /.*/, namespace: "ravel-test" }, () => ({
            contents: vscodeStub,
            loader: "js"
          }));
        }
      }]
    });
    const extension = require(output);
    const subscriptions = [];
    await extension.activate({
      extensionUri: UriForTest("file:///extension"),
      subscriptions: { push: (...values) => subscriptions.push(...values) },
      workspaceState: {
        get: () => undefined,
        update: async () => undefined
      }
    });

    const calls = globalThis.__ravelVscodeCalls;
    assert.deepEqual(
      calls.filter(({ kind }) => kind === "command").map(({ value }) => value[0]).sort(),
      [
        "ravel.nextGeneratedOccurrence",
        "ravel.openExplorer",
        "ravel.openGenerated",
        "ravel.previousGeneratedOccurrence",
        "ravel.returnToSource",
        "ravel.selectTarget"
      ]
    );
    assert.equal(calls.filter(({ kind }) => kind === "content-provider").length, 1);
    assert.equal(calls.filter(({ kind }) => kind === "completion").length, 2);
    assert.equal(calls.filter(({ kind }) => kind === "open-document").length, 1);
    for (const kind of [
      "signature",
      "type-definition",
      "rename",
      "call-hierarchy",
      "document-symbols",
      "code-lens"
    ]) {
      assert.equal(calls.filter((entry) => entry.kind === kind).length, 1, kind);
    }
    assert.ok(subscriptions.length >= 20);
    await extension.deactivate();
  } finally {
    delete globalThis.__ravelVscodeCalls;
    await rm(directory, { recursive: true, force: true });
  }
});

const UriForTest = (value) => ({
  scheme: "file",
  fsPath: value.replace(/^file:\/\//, ""),
  toString: () => value
});
