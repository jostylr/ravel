# @pieceful/ravel-markdown

The portable Markdown adapter for Ravel. It extracts explicitly named Ravel
fences, source ranges, front matter, greedy fragments, and composition
directives into a Ravel Map.

```sh
npm install @pieceful/ravel-markdown
```

Its public entry point is `markdownToMap(text, options)`. Use it with
`@pieceful/ravel-core` to evaluate the resulting map, or with a host package to
load Markdown from files. The adapter is native ESM and has no filesystem or
process dependency, so it is suitable for browser, Bun, and Node embedding.

Ravel's default Markdown mode leaves ordinary fences alone; primary mode
requires explicit Ravel classification for every relevant fence.
In 0.2 development, an explicitly named fence can add `.run`; the adapter
retains its real language and emits portable execution metadata without
executing the block.

See the [Ravel documentation](https://ravel.jostylr.com/) for the Markdown
fenced-block profile, directives, and examples.

MIT © James Taylor
