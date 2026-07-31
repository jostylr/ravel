import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_ERROR_CODES,
  LanguageBridgeError,
  assertLanguageRequest,
  assertVirtualDocument,
  bridgeError,
  createBridgeCapabilities,
  requireLanguageRequestSupport,
  throwIfAborted
} from "@pieceful/ravel-language-bridge";
import { createNormalizers, flattenNavigationTree, rangeForSpan } from "./normalize.js";
import {
  TypeScriptProject,
  resolveConfigPath,
  resolveVirtualFileName
} from "./typescript-project.js";

const languageIds = Object.freeze([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact"
]);
const supportedStages = Object.freeze(["authoring", "assembled"]);

const capabilities = createBridgeCapabilities({
  completion: { stages: supportedStages, triggerCharacters: [".", "\"", "'", "/", "@", "<", "#", " "], resolveProvider: true },
  completionDetails: { stages: supportedStages },
  hover: { stages: supportedStages },
  signatureHelp: { stages: supportedStages, triggerCharacters: ["(", ",", "<"] },
  definition: { stages: supportedStages },
  typeDefinition: { stages: supportedStages },
  references: { stages: supportedStages },
  documentSymbols: { stages: supportedStages },
  workspaceSymbols: { stages: supportedStages, workspaceProvider: true },
  diagnostics: { stages: supportedStages },
  prepareCallHierarchy: { stages: supportedStages },
  incomingCalls: { stages: supportedStages },
  outgoingCalls: { stages: supportedStages },
  prepareRename: { stages: supportedStages },
  rename: { stages: supportedStages }
});

const requestUri = (request, context) =>
  request.documentUri ?? context.document?.uri ?? context.documentUri;

const compareDiagnostics = (left, right) =>
  left.uri.localeCompare(right.uri) || left.range.start - right.range.start ||
  left.range.end - right.range.end || String(left.code).localeCompare(String(right.code));

const dedupeDiagnostics = (diagnostics) => {
  const seen = new Set();
  return diagnostics.filter((entry) => {
    const key = [entry.uri, entry.range.start, entry.range.end, entry.code, entry.message].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort(compareDiagnostics);
};

const positionFor = (request) => {
  if (!Number.isInteger(request.position) || request.position < 0) {
    throw new LanguageBridgeError(
      BRIDGE_ERROR_CODES.INVALID_REQUEST,
      request.kind + " requires a non-negative integer position."
    );
  }
  return request.position;
};

const normalizeWorkspaceSymbol = (normalizers, item) => ({
  name: item.name,
  kind: item.kind,
  kindModifiers: item.kindModifiers,
  uri: normalizers.uriForFile(item.fileName),
  range: rangeForSpan(item.textSpan),
  selectionRange: rangeForSpan(item.matchKind === "exact" ? item.textSpan : item.textSpan),
  containerName: item.containerName
});

export class TypeScriptLanguageBridge {
  constructor(ts, options = {}) {
    this.ts = ts;
    const currentDirectory = path.resolve(options.currentDirectory ?? ts.sys.getCurrentDirectory());
    this.options = {
      currentDirectory,
      configSearchRoot: path.resolve(currentDirectory, options.configSearchRoot ?? "."),
      fileURLToPath,
      compilerOptions: options.compilerOptions,
      tsconfigPath: options.tsconfigPath,
      configFileForDocument: options.configFileForDocument,
      fileNameForDocument: options.fileNameForDocument,
      completionOptions: options.completionOptions ?? {},
      userPreferences: options.userPreferences ?? {},
      formatOptions: options.formatOptions ?? {}
    };
    this.languageIds = languageIds;
    this.capabilities = capabilities;
    this.documents = new Map();
    this.projects = new Map();
    this.lifecycleState = "ready";
    this.restartDocuments = undefined;
  }

  get state() { return this.lifecycleState; }

  assertReady() {
    if (this.lifecycleState === "disposed") {
      throw new LanguageBridgeError(BRIDGE_ERROR_CODES.DISPOSED, "The TypeScript language bridge is disposed.");
    }
    if (this.lifecycleState === "failed") {
      throw new LanguageBridgeError(BRIDGE_ERROR_CODES.CRASHED, "The TypeScript language bridge must be restarted.", { retryable: true });
    }
  }

  projectKey(configPath, targetId, stage) {
    const target = String(targetId ?? "default");
    const projectionStage = String(stage ?? "assembled");
    if (!configPath) {
      return JSON.stringify([target, projectionStage, "inferred", this.options.currentDirectory]);
    }
    return JSON.stringify([target, projectionStage, "configured", path.normalize(configPath)]);
  }

  ensureProject(configPath, targetId, stage) {
    const key = this.projectKey(configPath, targetId, stage);
    let project = this.projects.get(key);
    if (!project) {
      project = new TypeScriptProject(
        this.ts,
        key,
        configPath,
        this.options,
        this.ts.createDocumentRegistry(
          this.ts.sys.useCaseSensitiveFileNames,
          this.options.currentDirectory
        )
      );
      this.projects.set(key, project);
    }
    return project;
  }

  createEntry(document) {
    if (!this.languageIds.includes(document.languageId)) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.NOT_SUPPORTED,
        "Unsupported TypeScript bridge language ID: " + document.languageId + ".",
        { details: { languageId: document.languageId, supported: this.languageIds } }
      );
    }
    const fileName = resolveVirtualFileName(document, this.options);
    const configPath = resolveConfigPath(this.ts, document, fileName, this.options);
    const project = this.ensureProject(configPath, document.targetId, document.stage);
    return { uri: document.uri, document, fileName, project, configPath };
  }

  async open(document, signal) {
    this.assertReady();
    throwIfAborted(signal);
    assertVirtualDocument(document);
    const current = this.documents.get(document.uri);
    if (current) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.DOCUMENT_COLLISION,
        "The virtual document is already open: " + document.uri + ".",
        { details: { uri: document.uri, version: current.document.version } }
      );
    }
    try {
      const entry = this.createEntry(document);
      // Cancellation is accepted up to this commit boundary. Once the project
      // and bridge indexes start changing, open must either finish or roll
      // back; reporting ABORTED after a successful commit would leave callers
      // believing the document is closed while it is actually open here.
      throwIfAborted(signal);
      entry.project.add(entry);
      this.documents.set(document.uri, entry);
    } catch (error) {
      throw bridgeError(error, {
        code: BRIDGE_ERROR_CODES.PROJECT_ERROR,
        message: "TypeScript could not open " + document.uri + ": " + (error?.message ?? String(error)),
        details: { uri: document.uri, version: document.version }
      });
    }
  }

  async change(previous, next, changes = [], signal) {
    this.assertReady();
    throwIfAborted(signal);
    assertVirtualDocument(previous);
    assertVirtualDocument(next);
    const current = this.documents.get(previous.uri);
    if (!current) {
      throw new LanguageBridgeError(BRIDGE_ERROR_CODES.DOCUMENT_NOT_OPEN, "The virtual document is not open: " + previous.uri + ".");
    }
    if (current.document.version !== previous.version || next.uri !== previous.uri) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.STALE_DOCUMENT,
        "The TypeScript change does not match the currently open document.",
        { details: { currentVersion: current.document.version, previousVersion: previous.version, uri: previous.uri } }
      );
    }
    if (next.version <= current.document.version) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.VERSION_REGRESSION,
        "Virtual document versions must increase monotonically.",
        { details: { currentVersion: current.document.version, nextVersion: next.version, uri: next.uri } }
      );
    }

    let nextFileName;
    let nextConfigPath;
    let nextProject;
    try {
      nextFileName = resolveVirtualFileName(next, this.options);
      nextConfigPath = resolveConfigPath(this.ts, next, nextFileName, this.options);
      nextProject = this.ensureProject(nextConfigPath, next.targetId, next.stage);
    } catch (error) {
      throw bridgeError(error, {
        code: BRIDGE_ERROR_CODES.PROJECT_ERROR,
        message: "TypeScript could not update " + next.uri + ": " + (error?.message ?? String(error)),
        details: { uri: next.uri, version: next.version }
      });
    }
    // This is the change commit boundary. Do not observe cancellation again
    // after removing the current entry: the rollback below only covers a
    // failed commit, while a successful commit must be reported as success.
    throwIfAborted(signal);
    current.project.remove(current);
    const entry = {
      uri: next.uri,
      document: next,
      fileName: nextFileName,
      project: nextProject,
      configPath: nextConfigPath,
      changes: [...changes]
    };
    try {
      nextProject.add(entry);
      this.documents.set(next.uri, entry);
    } catch (error) {
      current.project.add(current);
      throw bridgeError(error, {
        code: BRIDGE_ERROR_CODES.PROJECT_ERROR,
        message: "TypeScript could not update " + next.uri + ": " + (error?.message ?? String(error)),
        details: { uri: next.uri, version: next.version }
      });
    }
  }

  async close(document) {
    this.assertReady();
    assertVirtualDocument(document);
    const current = this.documents.get(document.uri);
    if (!current) {
      throw new LanguageBridgeError(BRIDGE_ERROR_CODES.DOCUMENT_NOT_OPEN, "The virtual document is not open: " + document.uri + ".");
    }
    current.project.remove(current);
    this.documents.delete(document.uri);
  }

  resolveRequest(request, context) {
    const uri = requestUri(request, context);
    if (typeof uri !== "string" || uri.length === 0) {
      throw new LanguageBridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST, request.kind + " requires a document URI.");
    }
    const entry = this.documents.get(uri);
    if (!entry) {
      throw new LanguageBridgeError(BRIDGE_ERROR_CODES.DOCUMENT_NOT_OPEN, "The request document is not open: " + uri + ".");
    }
    const expectedVersion = context.version ?? context.document?.version;
    if (expectedVersion !== undefined && expectedVersion !== entry.document.version) {
      throw new LanguageBridgeError(
        BRIDGE_ERROR_CODES.STALE_DOCUMENT,
        "The request targets a stale virtual document version.",
        { details: { expectedVersion, currentVersion: entry.document.version, uri } }
      );
    }
    return entry;
  }

  async request(request, context = {}, signal) {
    this.assertReady();
    throwIfAborted(signal);
    assertLanguageRequest(request);
    requireLanguageRequestSupport(this, request, {
      ...context,
      stage: context.document?.stage ?? context.stage ?? "assembled"
    });
    const entry = this.resolveRequest(request, context);
    const project = entry.project;
    const service = project.service;
    const normalizers = createNormalizers(this.ts, project);
    project.activeSignal = signal;
    try {
      let result;
      switch (request.kind) {
        case "completion":
          result = normalizers.completion(service.getCompletionsAtPosition(
            entry.fileName,
            positionFor(request),
            { ...this.options.completionOptions, ...request.options },
            request.formatOptions ?? this.options.formatOptions
          ));
          break;
        case "completionDetails":
          if (typeof request.name !== "string" || request.name.length === 0) {
            throw new LanguageBridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST, "completionDetails requires an entry name.");
          }
          result = normalizers.completionDetails(service.getCompletionEntryDetails(
            entry.fileName,
            positionFor(request),
            request.name,
            request.formatOptions ?? this.options.formatOptions,
            request.source,
            { ...this.options.userPreferences, ...request.preferences },
            request.data
          ));
          break;
        case "hover":
          result = normalizers.hover(service.getQuickInfoAtPosition(entry.fileName, positionFor(request)));
          break;
        case "signatureHelp":
          result = normalizers.signature(service.getSignatureHelpItems(
            entry.fileName,
            positionFor(request),
            {
              triggerReason: { kind: "invoked" },
              ...(request.options ?? {})
            }
          ));
          break;
        case "definition":
          result = normalizers.locations(service.getDefinitionAtPosition(entry.fileName, positionFor(request)));
          break;
        case "typeDefinition":
          result = normalizers.locations(service.getTypeDefinitionAtPosition(entry.fileName, positionFor(request)));
          break;
        case "references":
          result = normalizers.locations(service.getReferencesAtPosition(entry.fileName, positionFor(request)));
          break;
        case "documentSymbols":
          result = flattenNavigationTree(
            service.getNavigationTree(entry.fileName),
            normalizers.uriForFile(entry.fileName)
          );
          break;
        case "workspaceSymbols":
          result = service.getNavigateToItems(
            typeof request.query === "string" ? request.query : "",
            request.maximumResultCount,
            request.excludeFileName,
            request.excludeDtsFiles === true
          ).map((item) => normalizeWorkspaceSymbol(normalizers, item));
          break;
        case "diagnostics": {
          const categories = new Set(request.categories ?? ["configuration", "compilerOptions", "syntactic", "semantic", "suggestion"]);
          const diagnostics = [];
          if (categories.has("configuration")) {
            diagnostics.push(...project.configuration.diagnostics.filter((diagnostic) =>
              diagnostic.code !== 18003 || project.documents.size === 0));
          }
          if (categories.has("compilerOptions")) diagnostics.push(...service.getCompilerOptionsDiagnostics());
          if (categories.has("syntactic")) diagnostics.push(...service.getSyntacticDiagnostics(entry.fileName));
          if (categories.has("semantic")) diagnostics.push(...service.getSemanticDiagnostics(entry.fileName));
          if (categories.has("suggestion")) diagnostics.push(...service.getSuggestionDiagnostics(entry.fileName));
          result = dedupeDiagnostics(normalizers.diagnostics(diagnostics, entry.fileName));
          break;
        }
        case "prepareCallHierarchy":
          result = normalizers.callItems(service.prepareCallHierarchy(entry.fileName, positionFor(request)));
          break;
        case "incomingCalls":
          result = normalizers.incomingCalls(service.provideCallHierarchyIncomingCalls(entry.fileName, positionFor(request)));
          break;
        case "outgoingCalls":
          result = normalizers.outgoingCalls(service.provideCallHierarchyOutgoingCalls(entry.fileName, positionFor(request)));
          break;
        case "prepareRename": {
          const info = service.getRenameInfo(
            entry.fileName,
            positionFor(request),
            { allowRenameOfImportPath: request.allowRenameOfImportPath === true }
          );
          result = info.canRename
            ? {
                canRename: true,
                range: rangeForSpan(info.triggerSpan),
                placeholder: info.displayName,
                fullDisplayName: info.fullDisplayName,
                kind: info.kind,
                kindModifiers: info.kindModifiers
              }
            : { canRename: false, reason: info.localizedErrorMessage };
          break;
        }
        case "rename": {
          if (typeof request.newName !== "string" || request.newName.length === 0) {
            throw new LanguageBridgeError(BRIDGE_ERROR_CODES.INVALID_REQUEST, "rename requires a non-empty newName.");
          }
          const position = positionFor(request);
          const info = service.getRenameInfo(
            entry.fileName,
            position,
            { allowRenameOfImportPath: request.allowRenameOfImportPath === true }
          );
          result = info.canRename
            ? {
                canRename: true,
                changes: normalizers.renameLocations(service.findRenameLocations(
                  entry.fileName,
                  position,
                  request.findInStrings === true,
                  request.findInComments === true,
                  request.providePrefixAndSuffixTextForRename === true
                ), request.newName)
              }
            : { canRename: false, reason: info.localizedErrorMessage, changes: [] };
          break;
        }
      }
      throwIfAborted(signal);
      if (entry.document.version !== (context.version ?? context.document?.version ?? entry.document.version)) {
        throw new LanguageBridgeError(BRIDGE_ERROR_CODES.STALE_DOCUMENT, "The language response was superseded by a newer projection.", { retryable: true });
      }
      return result;
    } catch (error) {
      if (signal?.aborted) throwIfAborted(signal);
      throw bridgeError(error, {
        code: BRIDGE_ERROR_CODES.PROJECT_ERROR,
        message: "TypeScript " + request.kind + " failed: " + (error?.message ?? String(error)),
        retryable: true,
        details: { kind: request.kind, uri: entry.uri, version: entry.document.version }
      });
    } finally {
      project.activeSignal = undefined;
    }
  }

  async restart() {
    if (this.lifecycleState === "disposed") this.assertReady();
    this.lifecycleState = "restarting";
    const documents = this.restartDocuments ??
      [...this.documents.values()].map((entry) => entry.document);
    this.restartDocuments = documents;
    for (const project of this.projects.values()) project.dispose();
    this.projects.clear();
    this.documents.clear();
    try {
      for (const document of documents) {
        const entry = this.createEntry(document);
        entry.project.add(entry);
        this.documents.set(entry.uri, entry);
      }
      this.lifecycleState = "ready";
      this.restartDocuments = undefined;
    } catch (error) {
      this.lifecycleState = "failed";
      throw bridgeError(error, {
        code: BRIDGE_ERROR_CODES.CRASHED,
        message: "The TypeScript language bridge could not restart.",
        retryable: true
      });
    }
  }

  async dispose() {
    if (this.lifecycleState === "disposed") return;
    for (const project of this.projects.values()) project.dispose();
    this.projects.clear();
    this.documents.clear();
    this.restartDocuments = undefined;
    this.lifecycleState = "disposed";
  }
}
