---
ravel:
  document: fizzbuzz
---

# FizzBuzz migrated from the legacy Markdown form

This is a static-weaving migration of the legacy
[`fizzbuzz.md`](../../../tests/tests-full/fizzbuzz/fizzbuzz.md) example.  The
code pieces are explicit fenced chunks instead of being inferred from headings
and links.

```ravel
in("fizzbuzz-library.md")

create("fizzbuzz.js", compose(
  _"program:preamble.js",
  newline(2),
  _"program:main.js",
  pass(trim(), emit("source.js")),
  pipe(trim(), emit("compact.js"))
))

alias("public.js", _"fizzbuzz.js")
out("dist/fizzbuzz.js", _"public.js")
out("dist/fizzbuzz-source.js", _"fizzbuzz:source.js")
out("dist/fizzbuzz-compact.js", _"fizzbuzz:compact.js")
```

```javascript {.ravel #program--preamble type=js .generated}
/* Generated from a Ravel Markdown document. */
```

## Initial array

```javascript {.ravel #program--initial-array type=js}
const values = Array.from({ length: 100 }, (_, index) => index + 1);
```

## Greedy helper fragments

The old document's `Overwrite multiples in array` section was one inferred
block.  Here it is an explicit chunk that intentionally spans three adjacent
fences, including a closing `.end` fence.

```javascript {.ravel #program--helpers type=js .greedy}
function overwriteMultiples(values, multiple, label) {
```

```javascript
  for (let index = multiple - 1; index < values.length; index += multiple) {
    values[index] = label;
  }
```

```javascript {.end}
}
```

## Main program

`main` demonstrates ordinary embedded references.  The local pieces retain
their `program` base name and minor, while the formatter is explicitly scoped
to the imported document.  `dedent()` makes this fence's prose-friendly
indentation irrelevant to the emitted JavaScript.

```javascript {.ravel #program--main type=js pipe="dedent()"}
  _"program:initial-array.js"

  _"fizzbuzz-library::format-output.js"

  _"program:helpers.js"

  overwriteMultiples(values, 3, "Fizz");
  overwriteMultiples(values, 5, "Buzz");
  overwriteMultiples(values, 15, "FizzBuzz");

  console.log(formatOutput(values));
```

```javascript {.no-ravel}
// This ordinary Markdown example is deliberately excluded in primary mode.
const aDemonstrationOnlySnippet = true;
```
