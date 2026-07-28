# Live modules example

This project parses a CSV resource in two `.run` JavaScript blocks. It uses the
ordinary npm installation in this directory:

```sh
npm install
npm run live
```

`ravel.toml` exposes the package's browser-compatible sync export under the virtual import specifier
`@example/csv`:

```toml
[[live.modules]]
specifier = "@example/csv"
from = "csv-parse/browser/esm/sync"
```

The Node host bundles that installed package export into QuickJS-compatible
ESM. The worker receives only the bundle source. It cannot resolve another npm
package, read `node_modules`, or access the filesystem.

Likewise, `cool.csv` is readable only because the TOML explicitly maps it to a
live resource:

```toml
[[live.resources]]
name = "cool.csv"
path = "cool.csv"
```

`ravel run` prints the exported values and does not write build outputs.

The example also shows how normal Ravel processing consumes a live result:

```sh
npm run build
cat .ravel/build/report.txt
```

A live string can flow directly into a pipe or `out`. A structured live export
stays an object for `ch()` consumers. Ordinary text processing uses
`jsontext()` to serialize the whole value:

```text
_"summarize.js | jsontext()"
```

or supplies a top-level key:

```text
_"summarize.js | jsontext('report')"
```

If the selected value is a string, it becomes raw text. Other selected JSON
values become compact JSON text. More elaborate formatting belongs in the live
block.
