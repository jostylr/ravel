import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prepareQuartoRender } from "../packages/quarto/src/index.js";

const run = promisify(execFile);
const sandbox = await mkdtemp(join(tmpdir(), "ravel-quarto-smoke-"));
try {
  const render = async (name) => {
    const source = await readFile(
      new URL("../fixtures/quarto/" + name + ".qmd", import.meta.url),
      "utf8"
    );
    const prepared = prepareQuartoRender(source, {
      uri: name + ".qmd"
    });
    assert.deepEqual(prepared.diagnostics, []);
    const input = join(sandbox, name + ".qmd");
    await writeFile(input, prepared.source);
    await run("quarto", ["render", input, "--to", "html"], {
      cwd: sandbox
    });
    return {
      prepared,
      html: await readFile(join(sandbox, name + ".html"), "utf8")
    };
  };

  const staticRender = await render("static-listing");
  assert.match(
    staticRender.html,
    /Listing(?:&nbsp;|\s)+1: Main program/
  );
  assert.match(staticRender.html, /href="#lst-lp-main"/);
  assert.match(staticRender.html, /href="#lst-lp-helper"/);
  assert.match(staticRender.html, /id="ravel-piece-index"/);
  assert.match(staticRender.html, /Uses:/);
  assert.match(staticRender.html, /Used by:/);

  const executableRender = await render("executable-cell");
  assert.match(executableRender.prepared.source, /print\(40 \+ 2\)/);
  assert.match(
    executableRender.html,
    /Listing(?:&nbsp;|\s)+2: Analysis/
  );
  assert.match(
    executableRender.html,
    /<span class="bu">print<\/span>\(<span class="dv">40<\/span>/
  );
  console.log(
    "Quarto renders native listings, woven code, graph links, and the piece index."
  );
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
