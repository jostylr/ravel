import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("../browser-test/", import.meta.url)));
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm"
};

const withinRoot = (path) => path === root || path.startsWith(root + sep);

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://ravel.test").pathname);
    const path = resolve(root, "." + (pathname === "/" ? "/runtime-contract.html" : pathname));
    if (!withinRoot(path)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(path);
    if (!info.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": mimeTypes[extname(path)] ?? "application/octet-stream" });
    response.end(await readFile(path));
  } catch (error) {
    if (error?.code === "ENOENT") response.writeHead(404).end("Not found");
    else response.writeHead(500).end("Server error");
  }
});

const listen = () => new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    resolveListen(server.address());
  });
});

const close = () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));

const pages = [
  { path: "runtime-contract.html", selector: "html", attribute: "ravelTest" },
  { path: "markdown-adapter.html", selector: "body", attribute: "ravelMarkdownTest" },
  { path: "js-live.html", selector: "body", attribute: "ravelJsLiveTest" },
  { path: "explorer.html", selector: "body", attribute: "ravelExplorerTest" }
];

const address = await listen();
const browser = await chromium.launch();

try {
  for (const expected of pages) {
    const page = await browser.newPage();
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });

    await page.goto(`http://127.0.0.1:${address.port}/${expected.path}`, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForFunction(({ selector, attribute }) => {
      const value = document.querySelector(selector)?.dataset[attribute];
      return value === "passed" || value === "failed";
    }, expected, { timeout: 10_000 });
    const outcome = await page.locator(expected.selector).evaluate((element, attribute) => element.dataset[attribute], expected.attribute);

    if (expected.path === "explorer.html" && outcome === "passed") {
      await page.selectOption("#lens", "derivation");
      await page.fill("#search", "program:main");
      await page.press("#search", "Enter");
      await page.waitForFunction(() =>
        document.querySelector("#details h1")?.textContent === "program:main.js"
      );
      await page.click("#upstream");
      await page.waitForFunction(() =>
        document.querySelector("#project-label")?.textContent.includes("upstream of program:main.js")
      );
    }
    await page.close();

    if (outcome !== "passed" || browserErrors.length) {
      throw new Error(`${expected.path} failed (${outcome}): ${browserErrors.join("; ") || "no page error reported"}`);
    }
    console.log(`Chromium conformance passed: ${expected.path}`);
  }
} finally {
  await browser.close();
  await close();
}
