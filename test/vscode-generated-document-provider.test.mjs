import assert from "node:assert/strict";
import test from "node:test";
import {
  createGeneratedDocumentRegistry
} from "../packages/vscode/src/generated-document-registry.js";
import {
  GENERATED_DOCUMENT_SCHEME,
  GeneratedDocumentProviderError,
  createGeneratedDocumentProvider,
  generatedDocumentMetadata,
  generatedOccurrenceRange,
  generatedTextDocumentIsCurrent,
  selectReturnToSourceMatch
} from "../packages/vscode/src/generated-document-provider.js";

const projection = (version, overrides = {}) => ({
  id: "projection:browser:app:assembled",
  snapshotId: "snapshot:" + version,
  version,
  workspaceId: "workspace",
  artifactId: "dist/app.ts",
  targetId: "browser",
  stage: "assembled",
  languageId: "typescript",
  text: "const first = 1;\nconst second = first;\n",
  occurrences: [
    {
      id: "occurrence:first:1",
      pieceId: "guide::first.ts",
      virtual: { start: 0, end: 16 },
      expansionPath: ["guide::main.ts", "guide::first.ts"]
    },
    {
      id: "occurrence:second:1",
      pieceId: "guide::second.ts",
      virtual: { start: 17, end: 38 },
      expansionPath: ["guide::main.ts", "guide::second.ts"]
    },
    {
      id: "occurrence:first:2",
      pieceId: "guide::first.ts",
      virtual: { start: 32, end: 37 },
      expansionPath: ["guide::main.ts", "guide::second.ts", "guide::first.ts"]
    }
  ],
  ...overrides
});

test("return-to-source selection falls back outside the opened occurrence without guessing", () => {
  const destination = (uri, offset, quality = "exact") => ({
    quality,
    sourceOffset: offset,
    source: {
      uri,
      range: {
        start: { offset },
        end: { offset }
      }
    }
  });
  const fallback = destination("guide.md", 42);
  assert.deepEqual(selectReturnToSourceMatch([]), { status: "unmapped" });
  assert.equal(selectReturnToSourceMatch([fallback]).match, fallback);
  assert.equal(selectReturnToSourceMatch([
    fallback,
    structuredClone(fallback)
  ]).status, "selected");
  assert.equal(selectReturnToSourceMatch([
    destination("guide.md", 42),
    destination("library.md", 9)
  ]).status, "ambiguous");
  assert.equal(selectReturnToSourceMatch([
    destination("guide.md", 42, "exact"),
    destination("library.md", 9, "anchored")
  ]).match.source.uri, "guide.md");
});

const positionAt = (text, offset) => {
  const bounded = Math.max(0, Math.min(offset, text.length));
  const prefix = text.slice(0, bounded);
  const lines = prefix.split("\n");
  return new Position(lines.length - 1, lines.at(-1).length);
};

class Uri {
  constructor(value) {
    this.value = value;
    this.scheme = new URL(value).protocol.slice(0, -1);
  }

  static parse(value) {
    return new Uri(value);
  }

  toString() {
    return this.value;
  }
}

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.disposed = false;
    this.event = (listener) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
  }

  fire(value) {
    for (const listener of [...this.listeners]) listener(value);
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class Selection extends Range {}

const createFakeVscode = () => {
  const calls = {
    registrations: [],
    languages: [],
    opens: [],
    shows: [],
    reveals: [],
    registrationDisposals: 0
  };
  let contentProvider;
  let openHook;

  const vscode = {
    Uri,
    EventEmitter,
    Position,
    Range,
    Selection,
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    workspace: {
      registerTextDocumentContentProvider(scheme, provider) {
        calls.registrations.push({ scheme, provider });
        contentProvider = provider;
        return {
          dispose() {
            calls.registrationDisposals += 1;
          }
        };
      },
      async openTextDocument(uri) {
        calls.opens.push(uri.toString());
        const text = contentProvider.provideTextDocumentContent(uri);
        await openHook?.();
        return {
          uri,
          languageId: "plaintext",
          getText: () => text,
          positionAt: (offset) => positionAt(text, offset)
        };
      }
    },
    languages: {
      async setTextDocumentLanguage(document, languageId) {
        calls.languages.push(languageId);
        return { ...document, languageId };
      }
    },
    window: {
      async showTextDocument(document, options) {
        calls.shows.push({ document, options });
        return {
          document,
          selection: undefined,
          revealRange(range, revealType) {
            calls.reveals.push({ range, revealType });
          }
        };
      }
    }
  };

  return {
    vscode,
    calls,
    setOpenHook(hook) {
      openHook = hook;
    }
  };
};

test("provider registers the virtual scheme, forwards URI changes, and keeps metadata out of content", () => {
  const registry = createGeneratedDocumentRegistry();
  const fake = createFakeVscode();
  const provider = createGeneratedDocumentProvider({
    vscode: fake.vscode,
    registry
  });
  const changes = [];
  provider.onDidChange((uri) => changes.push(uri));
  const document = registry.update(projection(1));

  assert.equal(provider.scheme, GENERATED_DOCUMENT_SCHEME);
  assert.equal(fake.calls.registrations.length, 1);
  assert.equal(fake.calls.registrations[0].scheme, GENERATED_DOCUMENT_SCHEME);
  assert.equal(changes.length, 1);
  assert.equal(changes[0] instanceof Uri, true);
  assert.equal(changes[0].toString(), document.uri);
  assert.equal(provider.provideTextDocumentContent(changes[0]), document.text);
  assert.equal(provider.provideTextDocumentContent(changes[0]).startsWith("Target:"), false);

  const metadata = provider.metadata(document.uri);
  assert.deepEqual(metadata, generatedDocumentMetadata(document));
  assert.match(metadata.header, /Target: browser/);
  assert.match(metadata.header, /Artifact: dist\/app\.ts/);
  assert.deepEqual(metadata.targetSelection, {
    targetId: "browser",
    artifactId: "dist/app.ts"
  });
  assert.equal(Object.isFrozen(metadata.targetSelection), true);
  assert.equal(metadata.readOnly, true);
  assert.equal(Object.isFrozen(metadata), true);

  registry.markStale(document.uri, "Rebuilding unsaved changes.");
  assert.equal(changes.length, 2);
  assert.equal(provider.provideTextDocumentContent(document.uri), document.text);
  assert.equal(provider.metadata(document.uri).freshness, "stale");
  assert.match(provider.metadata(document.uri).header, /Rebuilding unsaved changes/);
});

test("stale and invalidated content policies can reject last-good text independently", () => {
  const staleRegistry = createGeneratedDocumentRegistry();
  const staleDocument = staleRegistry.update(projection(1));
  const staleProvider = createGeneratedDocumentProvider({
    vscode: createFakeVscode().vscode,
    registry: staleRegistry,
    stalePolicy: "reject"
  });
  staleRegistry.markStale(staleDocument.uri);
  assert.throws(
    () => staleProvider.provideTextDocumentContent(staleDocument.uri),
    (error) => error instanceof GeneratedDocumentProviderError && error.code === "stale"
  );

  const invalidatedRegistry = createGeneratedDocumentRegistry();
  const invalidatedDocument = invalidatedRegistry.update(projection(1));
  const invalidatedProvider = createGeneratedDocumentProvider({
    vscode: createFakeVscode().vscode,
    registry: invalidatedRegistry,
    stalePolicy: "last-good",
    invalidatedPolicy: "reject"
  });
  invalidatedRegistry.invalidate(invalidatedDocument.uri, "Target disappeared.");
  assert.throws(
    () => invalidatedProvider.provideTextDocumentContent(invalidatedDocument.uri),
    (error) => error instanceof GeneratedDocumentProviderError && error.code === "invalidated"
  );

  const retainedRegistry = createGeneratedDocumentRegistry();
  const retainedDocument = retainedRegistry.update(projection(1));
  const retainedProvider = createGeneratedDocumentProvider({
    vscode: createFakeVscode().vscode,
    registry: retainedRegistry,
    stalePolicy: "reject",
    invalidatedPolicy: "last-good"
  });
  retainedRegistry.invalidate(retainedDocument.uri, "Target disappeared.");
  assert.equal(
    retainedProvider.provideTextDocumentContent(retainedDocument.uri),
    retainedDocument.text
  );
  assert.equal(retainedProvider.metadata(retainedDocument.uri).freshness, "invalidated");
});

test("open and reveal set the target language and select the exact occurrence range", async () => {
  const registry = createGeneratedDocumentRegistry();
  const generated = registry.update(projection(1));
  const fake = createFakeVscode();
  const presented = [];
  const provider = createGeneratedDocumentProvider({
    vscode: fake.vscode,
    registry,
    presentMetadata: (metadata, context) => presented.push({ metadata, context })
  });
  const sourceSelection = {
    uri: "guide.md",
    range: { start: 17, end: 17 }
  };

  const result = await provider.revealOccurrence(
    generated.uri,
    "occurrence:second:1",
    { viewColumn: 2, preserveFocus: true, sourceSelection }
  );

  assert.deepEqual(fake.calls.languages, ["typescript"]);
  assert.equal(fake.calls.shows.length, 1);
  assert.equal(fake.calls.shows[0].options.viewColumn, 2);
  assert.equal(fake.calls.shows[0].options.preserveFocus, true);
  assert.deepEqual(result.range.start, new Position(1, 0));
  assert.deepEqual(result.range.end, new Position(1, 21));
  assert.equal(result.editor.selection instanceof Selection, true);
  assert.deepEqual(result.editor.selection, new Selection(result.range.start, result.range.end));
  assert.equal(fake.calls.reveals.length, 1);
  assert.equal(fake.calls.reveals[0].revealType, 2);
  assert.equal(result.occurrence.id, "occurrence:second:1");
  assert.equal(result.metadata.languageId, "typescript");
  assert.equal(presented[0].metadata, result.metadata);
  assert.equal(presented[0].context.occurrence, result.occurrence);
  assert.deepEqual(presented[0].context.sourceSelection, sourceSelection);
});

test("occurrence helpers navigate deterministically and honor version and wrap guards", async () => {
  const registry = createGeneratedDocumentRegistry();
  const generated = registry.update(projection(1));
  const fake = createFakeVscode();
  const provider = createGeneratedDocumentProvider({ vscode: fake.vscode, registry });

  const next = await provider.nextOccurrence(
    generated.uri,
    "occurrence:first:1",
    { pieceId: "guide::first.ts", expectedVersion: 1 }
  );
  assert.equal(next.occurrence.id, "occurrence:first:2");

  const previous = await provider.previousOccurrence(
    generated.uri,
    "occurrence:first:1",
    { pieceId: "guide::first.ts" }
  );
  assert.equal(previous.occurrence.id, "occurrence:first:2");

  assert.equal(await provider.previousOccurrence(
    generated.uri,
    "occurrence:first:1",
    { pieceId: "guide::first.ts", wrap: false }
  ), undefined);

  await assert.rejects(
    provider.revealOccurrence(generated.uri, "occurrence:first:1", {
      expectedSnapshotId: "snapshot:old"
    }),
    (error) => error instanceof GeneratedDocumentProviderError &&
      error.code === "version-mismatch"
  );
  await assert.rejects(
    provider.revealOccurrence(generated.uri, "removed"),
    (error) => error instanceof GeneratedDocumentProviderError &&
      error.code === "occurrence-not-found"
  );
});

test("async version changes abort before reveal and disposal detaches all events", async () => {
  const registry = createGeneratedDocumentRegistry();
  const generated = registry.update(projection(1));
  const fake = createFakeVscode();
  const provider = createGeneratedDocumentProvider({ vscode: fake.vscode, registry });
  fake.setOpenHook(() => {
    registry.update(projection(2, { text: generated.text.replace("1", "2") }));
  });

  await assert.rejects(
    provider.revealOccurrence(generated.uri, "occurrence:first:1"),
    (error) => error instanceof GeneratedDocumentProviderError &&
      error.code === "version-mismatch"
  );
  assert.equal(fake.calls.shows.length, 0);

  let changes = 0;
  provider.onDidChange(() => { changes += 1; });
  provider.dispose();
  provider.dispose();
  registry.update(projection(3, { text: generated.text.replace("1", "3") }));
  assert.equal(changes, 0);
  assert.equal(fake.calls.registrationDisposals, 1);
  assert.throws(
    () => provider.provideTextDocumentContent(generated.uri),
    (error) => error instanceof GeneratedDocumentProviderError && error.code === "disposed"
  );
});

test("range conversion rejects an occurrence beyond the loaded content", () => {
  const fake = createFakeVscode();
  const textDocument = {
    getText: () => "short",
    positionAt: (offset) => new Position(0, offset)
  };
  assert.throws(
    () => generatedOccurrenceRange(fake.vscode, textDocument, {
      virtual: { start: 0, end: 10 }
    }),
    (error) => error instanceof GeneratedDocumentProviderError &&
      error.code === "content-mismatch"
  );
});

test("generated editor authority requires exact registry text", () => {
  const generated = projection(1);
  assert.equal(generatedTextDocumentIsCurrent(generated, {
    getText: () => generated.text
  }), true);
  assert.equal(generatedTextDocumentIsCurrent(generated, {
    getText: () => generated.text + " stale"
  }), false);
  assert.equal(generatedTextDocumentIsCurrent(undefined, {
    getText: () => ""
  }), false);
});
