# Pieceful MyST plugin

```{piece} main | normalize-eol() | trim()
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

```{piece} pieceful-live
:language: javascript
:label: lp-pieceful-live
:cell:
:execution-owner: pieceful
:run:
:provider: quickjs-wasm-worker

export default 42;
```
