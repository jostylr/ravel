# `@pieceful/ravel-myst-plugin`

MyST rendering plugin for [Ravel](https://github.com/jostylr/ravel)’s canonical `{ravel:piece}` directive and its
short `{piece}` alias. It turns a piece into standard MyST code/container AST
nodes, giving it a visible caption, syntax highlighting, a stable
cross-reference label, and optional notebook-cell behavior. It also renders
`{ravel}` graph-directive blocks. It does not compile, weave, or execute code.

```yaml
# myst.yml
project:
  plugins:
    - node_modules/@pieceful/ravel-myst-plugin/plugin.mjs
```

````markdown
```{ravel:piece} main | trim()
:language: javascript
:caption: Main program
:label: lp-main

console.log(_"helper");
```

See [](#lp-main).
````

The definition pipeline is shown beside the caption by default. Set
`:show-pipeline: false` to hide it in rendered output.

`:cell:` maps the directive to a native MyST notebook code block and preserves
`:tags:`. MyST is the default execution owner. Use
`:execution-owner: ravel` to render the code without making it executable
by MyST; Ravel still requires an explicit live `run` request before executing
it through a configured provider.

Graph directives use the same body syntax as a Markdown `ravel` fence and
remain visible, static code in the rendered document:

````markdown
```{ravel}
out("dist/main.js", _"main")
```
````

Use `@pieceful/ravel-myst` separately to convert the same source into a Ravel
Map. The plugin handles presentation inside `myst build`; the adapter handles
Ravel semantics and exact source mapping.
