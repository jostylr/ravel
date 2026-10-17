import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { transformGraph } from "../packages/core/src/index.js";
import { loadBuildInput } from "../packages/host-node/src/index.js";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../packages/cli/src/index.js", import.meta.url));

const layout = "# Site\n\n```html {.ravel #layout}\n<title>{{ title | html }}</title>\n<main>{{ content }}</main>\n```\n\n```html {.ravel #index}\n<ul>{{#each items}}<li><a href=\"/{{ out }}\">{{ title }}</a></li>{{/each}}</ul>\n```\n\n```html {.ravel #home}\n_\"index.html | template('items', ch('pages::index.json'))\"\n```\n\n```ravel\nout(\"index.html\", _\"home.html\")\n```\n";

const makeSite = async (sandbox, collection = "") => {
  await mkdir(join(sandbox, "pages", "notes"), { recursive: true });
  await writeFile(join(sandbox, "site.md"), layout);
  await writeFile(join(sandbox, "pages", "about.md"), "---\ntitle: About & Us\n---\n# About\n\nHello _\"not-a-ref\" *there*.\n");
  await writeFile(join(sandbox, "pages", "notes", "first.md"), "---\ntitle: First note\nslug: note-one\n---\nSome **note**.\n");
  await writeFile(join(sandbox, "pages", ".draft.md"), "ignored\n");
  await writeFile(join(sandbox, "ravel.toml"), "version = 1\n\n[build]\nout_dir = \"build\"\n\n[[files]]\npath = \"site.md\"\n\n[[collections]]\nname = \"pages\"\nglob = \"pages/**/*.md\"\nout = \"{dir}/{slug}.html\"\nlayout = \"site::layout.html\"\n" + collection);
};

test("collections turn every matching file into a laid-out page with an index", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-collections-"));
  try {
    await makeSite(sandbox);
    const result = await run(process.execPath, [cli, "build", "--config", "ravel.toml", "--json"], { cwd: sandbox });
    const built = JSON.parse(result.stdout);
    assert.deepEqual(built.deliverables.map((deliverable) => deliverable.name), ["index.html", "pages/about.html", "pages/notes/note-one.html"]);
    assert.equal(
      await readFile(join(sandbox, "build", "pages", "about.html"), "utf8"),
      "<title>About &amp; Us</title>\n<main><h1>About</h1>\n<p>Hello _&quot;not-a-ref&quot; <em>there</em>.</p>\n</main>\n"
    );
    assert.equal(
      await readFile(join(sandbox, "build", "index.html"), "utf8"),
      "<ul><li><a href=\"/pages/about.html\">About & Us</a></li><li><a href=\"/pages/notes/note-one.html\">First note</a></li></ul>\n\n"
    );
    // The layout text maps exactly to site.md; the title and content map back to the page file.
    const map = JSON.parse(await readFile(join(sandbox, "build", "pages", "about.html.ravelmap"), "utf8"));
    const describe = (segment) => [segment.precision, segment.source.uri, (segment.origins ?? []).map((origin) => origin.source.uri)];
    assert.deepEqual(describe(map.segments[0]), ["exact", "site.md", []]);
    assert.deepEqual(describe(map.segments[1]).at(-1), ["pages/about.md"]);
    assert.deepEqual(describe(map.segments[3]).at(-1), ["pages/about.md"]);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("collection items expose body, data, and page chunks with exact body ranges", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-collection-chunks-"));
  try {
    await makeSite(sandbox);
    const loaded = await loadBuildInput(join(sandbox, "ravel.toml"));
    assert.ok(loaded.loadedInputUris.includes("pages/about.md"));
    assert.ok(loaded.authoredSourceUris.includes("pages/notes/first.md"));
    assert.equal(loaded.loadedInputUris.includes("pages/.draft.md"), false);
    const program = transformGraph(loaded.pretransform, { transforms: loaded.transforms });
    assert.deepEqual(program.diagnostics, []);
    const body = program.chunks["pages-about::body"];
    assert.equal(body.value, "# About\n\nHello _\"not-a-ref\" *there*.\n");
    assert.equal(body.segments[0].precision, "exact");
    assert.deepEqual(body.segments[0].source.range.start, { line: 3, column: 0, offset: 26 });
    assert.deepEqual(JSON.parse(program.chunks["pages-note-one::data.json"].value), {
      title: "First note", slug: "note-one", name: "first", dir: "pages/notes", path: "pages/notes/first.md",
      out: "pages/notes/note-one.html", collection: "pages"
    });
    assert.equal(JSON.parse(program.chunks["pages::index.json"].value).length, 2);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("collections support no layout, a custom pipe, and opt-in references", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-collection-options-"));
  try {
    await mkdir(join(sandbox, "notes"));
    await writeFile(join(sandbox, "notes", "a.txt"), "plain _\"shared::shared.text\"\n");
    await writeFile(join(sandbox, "shared.md"), "```text {.ravel #shared}\nfrom shared\n```\n");
    await writeFile(join(sandbox, "ravel.toml"), "version = 1\n\n[[files]]\npath = \"shared.md\"\n\n[[collections]]\nname = \"notes\"\nglob = \"notes/*.txt\"\nout = \"{name}.out\"\npipe = \"trim\"\nreferences = true\n");
    const loaded = await loadBuildInput(join(sandbox, "ravel.toml"));
    const program = transformGraph(loaded.pretransform, { transforms: loaded.transforms });
    assert.deepEqual(program.diagnostics, []);
    assert.equal(program.deliverables["a.out"].value, "plain from shared");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("collections report invalid configuration and colliding items clearly", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "ravel-collection-errors-"));
  const config = (collection) => "version = 1\n\n[[collections]]\nname = \"pages\"\nglob = \"pages/*.md\"\nout = \"{slug}.html\"\n" + collection;
  try {
    await mkdir(join(sandbox, "pages"));
    await writeFile(join(sandbox, "pages", "a.md"), "---\nslug: same\n---\nA\n");
    await writeFile(join(sandbox, "pages", "b.md"), "---\nslug: same\n---\nB\n");
    await writeFile(join(sandbox, "ravel.toml"), config(""));
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /both produce the slug "same"/);

    await writeFile(join(sandbox, "pages", "b.md"), "---\ntitle: [unclosed\n---\nB\n");
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /Invalid front matter in pages\/b\.md/);

    await writeFile(join(sandbox, "pages", "b.md"), "B\n");
    await writeFile(join(sandbox, "ravel.toml"), config("").replace("{slug}.html", "{missing}.html"));
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /uses \{missing\}/);

    await writeFile(join(sandbox, "ravel.toml"), config("").replace("pages/*.md", "../pages/*.md"));
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /relative glob inside the Ravel root/);

    await writeFile(join(sandbox, "ravel.toml"), config("unknown = 1\n"));
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /unknown/);

    await mkdir(join(sandbox, "elsewhere"));
    await writeFile(join(sandbox, "elsewhere", "c.md"), "C\n");
    await symlink(join(sandbox, "elsewhere"), join(sandbox, "pages", "linked"));
    await writeFile(join(sandbox, "ravel.toml"), config("").replace("pages/*.md", "pages/**/*.md"));
    await assert.rejects(loadBuildInput(join(sandbox, "ravel.toml")), /must not traverse a symbolic link/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("the site example builds its pages, home page, and stylesheet", async () => {
  const loaded = await loadBuildInput(fileURLToPath(new URL("../examples/site/ravel.toml", import.meta.url)));
  const program = transformGraph(loaded.pretransform, { transforms: loaded.transforms });
  assert.deepEqual(program.diagnostics, []);
  assert.deepEqual(Object.keys(program.deliverables).sort(), ["index.html", "pages/about.html", "pages/notes/first.html", "style.css"]);
  assert.match(program.deliverables["pages/about.html"].value, /came from “pages\/about\.md”/);
  assert.match(program.deliverables["index.html"].value, /<a href="\/pages\/notes\/first\.html">A first note<\/a>/);
});
