# Browser test pages

This directory is self-contained: its HTML pages and the browser-safe shared
assertion modules they need live below this directory. The Node and Bun adapter
tests import those same shared modules. Serve this directory itself through any
static HTTP server, then open the page below in a modern browser:

    /runtime-contract.html

A passing page sets the root HTML element's `data-ravel-test` attribute to
`passed`; a failure sets it to `failed` and throws. Browser automation can use
that contract without changing the fixture or assertion modules.

## Markdown adapter

Build the browser-only bundle, then serve this directory and open
`markdown-adapter.html`:

    npm run build:browser-test

The generated bundle stays under `browser-test/generated/`, so a server rooted
at this folder needs no file outside its hierarchy. The page reports success in
its `data-ravel-markdown-test` attribute. It covers fenced chunk extraction plus
`ravel` directive `create`, `pipe`, `pass`, and local emitted chunks through the
portable core.
