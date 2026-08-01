# @pieceful/ravel-markdown

The portable Markdown adapter for [Ravel](https://github.com/jostylr/ravel). It extracts explicitly named Ravel
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
In 0.2, an explicitly named fence can add `.run`; the adapter
retains its real language and emits portable execution metadata without
executing the block.

The 0.2 modern profile is available through
`modernMarkdownToMap(text, options)`, `profile: "modern"`, or
`lp.adapter: markdown` in YAML front matter. It treats H2-H6 headings as piece
declarations by default. Unnamed fences belong to the current heading, while a
named `lp:name` or Pandoc `.lp-piece` fence owns only itself and does not change
the heading context. A pipeline may follow the heading name or appear on its
first unnamed fence. `.run` remains metadata in this profile; parsing never
executes a live block.

See the [Ravel documentation](https://ravel.jostylr.com/) for the Markdown
fenced-block profile, directives, and examples.

MIT © James Taylor
