import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { combineMaps, transformGraph } from "../packages/core/src/index.js";
import { validateRavelMap } from "../packages/map/src/index.js";
import { modernMarkdownToMap } from "../packages/markdown/src/index.js";
import { nowebToMap } from "../packages/noweb/src/index.js";
import { orgToMap } from "../packages/org/src/index.js";

const fixture = (name) =>
  readFile(new URL("../fixtures/org/" + name, import.meta.url), "utf8");

test("Org scans native names, affiliations, Babel metadata, results, and exact bodies", async () => {
  const source = await fixture("native.org");
  const adapted = orgToMap(source, {
    uri: "fixtures/org/native.org",
    document: "native"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "native::main",
    "native::format-greeting"
  ]);

  const main = adapted.map.chunks[0];
  assert.equal(main.metadata.language, "javascript");
  assert.equal(main.body, "console.log(<<format-greeting>>);\n");
  assert.equal(
    source.slice(main.fragments[0].source.range.start.offset, main.fragments[0].source.range.end.offset),
    main.fragments[0].body
  );
  const org = main.metadata.data.org.fragments[0];
  assert.equal(org.heading.title, "Program");
  assert.deepEqual(org.headerArguments.map((argument) => [argument.name, argument.value, argument.origin]), [
    ["cache", "yes", "file-property"],
    ["session", "*node*", "affiliated-header"],
    ["noweb", "yes", "begin-src"],
    ["tangle", "dist/main.js", "begin-src"],
    ["results", "output", "begin-src"],
    ["var", "greeting=\"hello world\"", "begin-src"]
  ]);
  for (const argument of org.headerArguments) {
    assert.match(
      source.slice(argument.source.range.start.offset, argument.source.range.end.offset),
      new RegExp("^:" + argument.name)
    );
  }
  assert.equal(main.body.includes("Hello"), false);
  assert.equal(adapted.map.metadata.resultArtifacts.length, 1);
  assert.equal(adapted.map.metadata.resultArtifacts[0].hash, "abc123");
  assert.equal(adapted.map.metadata.resultArtifacts[0].text, ": Hello\n");
  assert.equal(adapted.map.metadata.executionOwner, "org");
  assert.equal(adapted.map.metadata.plannedEffects[0].requests.tangle, "dist/main.js");
  assert.equal(main.metadata.data.ravel.run, undefined);

  const referenceOffset = source.indexOf("<<format-greeting>>");
  assert.equal(adapted.surface.references[0].source.range.start.offset, referenceOffset);
  assert.equal(adapted.surface.references[0].source.range.end.offset, referenceOffset + "<<format-greeting>>".length);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.match(program.chunks["native::main"].value, /function formatGreeting/);
});

test(":noweb-ref aggregates repeated fragments while #+NAME remains individually addressable", async () => {
  const source = await fixture("aggregate.org");
  const adapted = orgToMap(source, {
    uri: "fixtures/org/aggregate.org",
    document: "aggregate"
  });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(validateRavelMap(adapted.map), []);
  assert.deepEqual(adapted.map.chunks.map((chunk) => chunk.id), [
    "aggregate::first-fragment",
    "aggregate::shared",
    "aggregate::main"
  ]);
  assert.equal(adapted.map.chunks[0].body, "first();\n");
  assert.equal(adapted.map.chunks[1].body, "first();\nsecond();\n");
  assert.equal(adapted.map.chunks[1].fragments.length, 2);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["aggregate::main"].value, "first();\nsecond();\n\n");
});

test("#+LP_NAME pipelines and explicitly extended Org-noweb references use the shared grammar", () => {
  const adapted = orgToMap([
    "#+PROPERTY: pieceful-noweb-pipes yes",
    "#+LP_NAME: main | trim()",
    "#+BEGIN_SRC text",
    "  <<message | trim()>>  ",
    "#+END_SRC",
    "",
    "#+LP_NAME: message",
    "#+BEGIN_SRC text",
    "  hello  ",
    "#+END_SRC",
    ""
  ].join("\n"), {
    uri: "compact.org",
    document: "compact"
  });

  assert.equal(adapted.diagnostics.filter((entry) => entry.code === "LPA114").length, 1);
  assert.deepEqual(adapted.map.chunks[0].definitionPipeline.map((step) => step.name), ["trim"]);
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["compact::main"].value, "hello");
});

test("#+LP_NAME and #+NAME must agree and repeated pipelines must be identical", () => {
  const mismatch = orgToMap([
    "#+NAME: native",
    "#+LP_NAME: pieceful | trim()",
    "#+BEGIN_SRC text",
    "value",
    "#+END_SRC",
    ""
  ].join("\n"), { uri: "mismatch.org", document: "mismatch" });
  assert.ok(mismatch.diagnostics.some((entry) => entry.code === "LPA113"));

  const repeated = orgToMap([
    "#+LP_PIPE: trim()",
    "#+BEGIN_SRC text :noweb-ref shared",
    " first",
    "#+END_SRC",
    "",
    "#+LP_PIPE: indent(2)",
    "#+BEGIN_SRC text :noweb-ref shared",
    "second ",
    "#+END_SRC",
    ""
  ].join("\n"), { uri: "repeated.org", document: "repeated" });
  assert.ok(repeated.diagnostics.some((entry) =>
    entry.code === "LPA113" && entry.message.includes("conflicting pipelines")
  ));
});

test("reference policy can reserve Org-noweb expansion for Babel and use underscore-quote in Pieceful", () => {
  const adapted = orgToMap([
    "#+PROPERTY: pieceful-reference-style underscore-quote",
    "#+NAME: message",
    "#+BEGIN_SRC text",
    "hello",
    "#+END_SRC",
    "",
    "#+NAME: main",
    "#+BEGIN_SRC text",
    "<<message>> _\"message | trim()\"",
    "#+END_SRC",
    ""
  ].join("\n"), { uri: "references.org", document: "references" });

  assert.deepEqual(adapted.diagnostics, []);
  assert.equal(adapted.surface.references.length, 1);
  assert.equal(adapted.surface.references[0].targetText, "message | trim()");
  const program = transformGraph(combineMaps([adapted.map]));
  assert.deepEqual(program.diagnostics, []);
  assert.equal(program.chunks["references::main"].value, "<<message>> hello\n");
});

test("Babel execution and tangling require one explicit owner", () => {
  const unowned = orgToMap([
    "#+NAME: main",
    "#+BEGIN_SRC javascript :eval yes :tangle main.js",
    "export default 42;",
    "#+END_SRC",
    ""
  ].join("\n"), { uri: "unowned.org", document: "unowned" });
  assert.ok(unowned.diagnostics.some((entry) => entry.code === "LPA115"));
  assert.equal(unowned.map.chunks[0].metadata.data.ravel.run, undefined);

  const pieceful = orgToMap([
    "#+PROPERTY: pieceful-execution-owner pieceful",
    "#+NAME: main",
    "#+BEGIN_SRC javascript :eval yes :tangle main.js",
    "export default 42;",
    "#+END_SRC",
    ""
  ].join("\n"), {
    uri: "pieceful.org",
    document: "pieceful",
    provider: "quickjs-wasm-worker"
  });
  assert.deepEqual(pieceful.diagnostics, []);
  assert.equal(pieceful.map.chunks[0].metadata.data.ravel.run, true);
  assert.equal(pieceful.map.chunks[0].metadata.data.ravel.provider, "quickjs-wasm-worker");
  assert.equal(pieceful.map.directives.length, 0);
  assert.equal(pieceful.map.metadata.plannedEffects[0].requests.tangle, "main.js");
});

test("language-scoped subtree headers apply only within their Org subtree", () => {
  const adapted = orgToMap([
    "* Scope",
    ":PROPERTIES:",
    ":header-args: :cache yes",
    ":header-args:python: :session py",
    ":END:",
    "#+NAME: py",
    "#+BEGIN_SRC python",
    "print(1)",
    "#+END_SRC",
    "",
    "#+NAME: js",
    "#+BEGIN_SRC javascript",
    "console.log(1);",
    "#+END_SRC",
    ""
  ].join("\n"), { uri: "headers.org", document: "headers" });

  assert.deepEqual(adapted.diagnostics, []);
  const py = adapted.map.chunks[0].metadata.data.org.fragments[0].headerArguments;
  const js = adapted.map.chunks[1].metadata.data.org.fragments[0].headerArguments;
  assert.deepEqual(py.map((argument) => argument.name), ["cache", "session"]);
  assert.deepEqual(js.map((argument) => argument.name), ["cache"]);
});

test("unnamed and commented Org source blocks remain metadata, not pieces", () => {
  const adapted = orgToMap([
    "#+BEGIN_SRC text",
    "unnamed",
    "#+END_SRC",
    "",
    "#+BEGIN_COMMENT",
    "#+NAME: hidden",
    "#+BEGIN_SRC text",
    "hidden",
    "#+END_SRC",
    "#+END_COMMENT",
    ""
  ].join("\n"), { uri: "ignored.org", document: "ignored" });

  assert.deepEqual(adapted.diagnostics, []);
  assert.deepEqual(adapted.map.chunks, []);
  assert.deepEqual(adapted.map.metadata.ignoredBlocks.map((entry) => entry.reason), [
    "commented",
    "unnamed"
  ]);
});

test("Org, noweb, and modern Markdown normalize repeated pieces and pipelines equivalently", () => {
  const markdown = modernMarkdownToMap([
    "```{.text .lp-piece #lp-main lp-pipe=\"trim()\"}",
    "  _\"helper\"",
    "```",
    "",
    "```{.text .lp-fragment lp-for=\"main\"}",
    "tail  ",
    "```",
    "",
    "```{.text .lp-piece #lp-helper}",
    "value",
    "```",
    ""
  ].join("\n"), { uri: "equivalent.md", document: "equivalent" });
  const org = orgToMap([
    "#+LP_PIPE: trim()",
    "#+BEGIN_SRC text :noweb-ref main",
    "  _\"helper\"",
    "#+END_SRC",
    "",
    "#+BEGIN_SRC text :noweb-ref main",
    "tail  ",
    "#+END_SRC",
    "",
    "#+NAME: helper",
    "#+BEGIN_SRC text",
    "value",
    "#+END_SRC",
    ""
  ].join("\n"), {
    uri: "equivalent.org",
    document: "equivalent",
    references: "underscore-quote"
  });
  const noweb = nowebToMap([
    "@ %pieceful pipeline main | trim()",
    "<<main>>=",
    "  _\"helper\"",
    "@",
    "<<main>>=",
    "tail  ",
    "@",
    "<<helper>>=",
    "value",
    "@",
    ""
  ].join("\n"), {
    uri: "equivalent.nw",
    document: "equivalent",
    references: "both",
    language: "text"
  });

  const semantic = ({ map }) => map.chunks.map((chunk) => ({
    id: chunk.id,
    body: chunk.body,
    language: chunk.metadata.language,
    pipeline: chunk.definitionPipeline.map((step) => [step.name, step.arguments])
  }));
  assert.deepEqual(markdown.diagnostics, []);
  assert.deepEqual(org.diagnostics, []);
  assert.deepEqual(noweb.diagnostics, []);
  assert.deepEqual(semantic(org), semantic(markdown));
  assert.deepEqual(semantic(noweb), semantic(markdown));
  for (const adapted of [markdown, org, noweb]) {
    const program = transformGraph(combineMaps([adapted.map]));
    assert.deepEqual(program.diagnostics, []);
    assert.equal(program.chunks["equivalent::main"].value, "value\n\ntail");
  }
});
