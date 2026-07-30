import assert from "node:assert/strict";
import test from "node:test";
import plugin, {
  pieceDirective,
  ravelDirective
} from "../packages/myst-plugin/plugin.mjs";

const vfile = () => ({
  messages: [],
  message(message, node, source) {
    const entry = { message, node, source };
    this.messages.push(entry);
    return entry;
  }
});

test("Ravel MyST plugin exports canonical piece and graph directives", () => {
  assert.equal(plugin.name, "Ravel");
  assert.deepEqual(plugin.directives, [pieceDirective, ravelDirective]);
  assert.equal(pieceDirective.name, "ravel:piece");
  assert.deepEqual(pieceDirective.alias, ["piece"]);
  assert.equal(ravelDirective.name, "ravel");
  assert.equal(pieceDirective.body.type, String);
});

test("piece directive renders a labeled, captioned native code container", () => {
  const file = vfile();
  const [container] = pieceDirective.run({
    arg: "main | normalize-eol() | trim()",
    body: "console.log(_\"helper\");\n",
    options: {
      language: "javascript",
      caption: [{ type: "text", value: "Main program" }],
      label: "lp-main",
      class: "wide",
      enumerated: true
    }
  }, file);

  assert.deepEqual(file.messages, []);
  assert.equal(container.type, "container");
  assert.equal(container.kind, "code");
  assert.equal(container.label, "lp-main");
  assert.equal(container.identifier, "lp-main");
  assert.equal(container.class, "ravel-piece wide");
  assert.equal(container.enumerated, true);
  assert.deepEqual(container.data.ravel, {
    piece: "main",
    pipeline: "normalize-eol() | trim()",
    executionOwner: null
  });
  assert.deepEqual(container.children[0], {
    type: "code",
    lang: "javascript",
    value: "console.log(_\"helper\");\n"
  });
  assert.deepEqual(container.children[1].children[0].children, [
    { type: "text", value: "Main program" },
    { type: "text", value: " — " },
    { type: "inlineCode", value: "| normalize-eol() | trim()" }
  ]);
});

test("piece directive supplies a visible default caption and can hide the pipeline", () => {
  const [container] = pieceDirective.run({
    arg: "a name with \\| a literal pipe | trim()",
    body: "value\n",
    options: { "show-pipeline": false }
  }, vfile());

  assert.deepEqual(container.children[1].children[0].children, [
    { type: "text", value: "Piece: a name with | a literal pipe" }
  ]);
  assert.equal(container.label, undefined);
});

test("a MyST-owned cell becomes an executable notebook block", () => {
  const [block] = pieceDirective.run({
    arg: "analysis",
    body: "print('hello')\n",
    options: {
      language: "python",
      caption: [{ type: "text", value: "Analysis" }],
      label: "lp-analysis",
      cell: true,
      tags: "[hide-output, raises-exception]"
    }
  }, vfile());

  assert.equal(block.type, "block");
  assert.equal(block.kind, "code");
  assert.equal(block.children[0].executable, true);
  assert.equal(block.children[1].type, "outputs");
  assert.match(block.children[1].id, /^piece-/);
  assert.deepEqual(block.data.tags, ["hide-output", "raises-exception"]);
  assert.equal(block.data.ravel.executionOwner, "myst");
});

test("a Ravel-owned cell renders statically and never claims MyST execution", () => {
  const [container] = pieceDirective.run({
    arg: "analysis",
    body: "export default 42;\n",
    options: {
      language: "javascript",
      label: "lp-analysis",
      cell: true,
      "execution-owner": "ravel",
      run: true,
      provider: "quickjs-wasm-worker"
    }
  }, vfile());

  assert.equal(container.type, "container");
  assert.equal(container.children[0].executable, undefined);
  assert.equal(container.data.ravel.executionOwner, "ravel");
  assert.equal(container.data.ravel.run, true);
  assert.equal(container.data.ravel.provider, "quickjs-wasm-worker");
});

test("ravel directive renders the graph DSL as visible static code", () => {
  const [container] = ravelDirective.run({
    body: "out(\"dist/main.js\", _\"main\")\n",
    options: {
      caption: [{ type: "text", value: "Build outputs" }],
      label: "ravel-outputs"
    }
  });

  assert.equal(container.type, "container");
  assert.equal(container.kind, "code");
  assert.equal(container.class, "ravel-directives");
  assert.equal(container.identifier, "ravel-outputs");
  assert.equal(container.children[0].lang, "ravel");
  assert.equal(container.children[0].executable, undefined);
  assert.equal(
    container.children[1].children[0].children[0].value,
    "Build outputs"
  );
});

test("piece directive reports an empty name or unknown execution owner", () => {
  const emptyFile = vfile();
  assert.deepEqual(pieceDirective.run({ arg: "", body: "", options: {} }, emptyFile), []);
  assert.equal(emptyFile.messages[0].fatal, true);

  const ownerFile = vfile();
  const [container] = pieceDirective.run({
    arg: "main",
    body: "value\n",
    options: { "execution-owner": "both" }
  }, ownerFile);
  assert.equal(ownerFile.messages[0].fatal, true);
  assert.equal(container.data.ravel.executionOwner, "both");
});
