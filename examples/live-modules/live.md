# Live CSV exploration

The first live block reads an allowlisted text resource and imports an
allowlisted npm package export. Its default export becomes the block value.

```js {.run #parse-csv}
import { parse } from "@example/csv";

const csv = load("cool.csv");
export default parse(csv, {
  columns: true,
  skip_empty_lines: true,
  cast: true
});
```

The next block receives a copy of that value through `ch()`.

```js {.run #summarize}
const rows = ch("parse-csv");
const total = rows.reduce(
  (sum, row) => sum + row.quantity * row.price,
  0
);

export default {
  items: rows.map((row) => row.item),
  rows: rows.length,
  total
};
```
