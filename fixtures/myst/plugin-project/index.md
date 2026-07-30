# Ravel MyST plugin

```{ravel:piece} main | normalize-eol() | trim()
:language: javascript
:caption: Main program
:label: lp-main
:class: wide

console.log(_"helper");
```

The entry point is [](#lp-main), or equivalently {ref}`lp-main`.

```{piece} analysis
:language: python
:label: lp-analysis
:cell:
:tags: [hide-output]

print("analysis")
```

See @lp-analysis.

```{ravel:piece} ravel-live
:language: javascript
:label: lp-ravel-live
:cell:
:execution-owner: ravel
:run:
:provider: quickjs-wasm-worker

export default 42;
```

```{ravel}
:caption: Build directives
:label: ravel-build

out("dist/main.js", _"main")
```
