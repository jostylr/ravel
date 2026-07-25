---
ravel:
  document: fizzbuzz
---

# FizzBuzz, woven from one document

The program is assembled from named pieces. Edit a chunk or rearrange the
references in `program:main.js`, then render to see the generated file.

```ravel
create("fizzbuzz.js", compose(
  _"program:preamble.js",
  newline(2),
  _"program:main.js"
))

out("dist/fizzbuzz.js", _"fizzbuzz.js")
```

```javascript {.ravel #program--preamble type=js}
/* Generated from a Ravel Markdown document. */
```

## Initial values

```javascript {.ravel #program--initial-array type=js}
const values = Array.from({ length: 100 }, (_, index) => index + 1);
```

## Formatting

```javascript {.ravel #format-output type=js}
function formatOutput(values) {
  return values.join(", ");
}
```

## Replacement helper

```javascript {.ravel #program--helpers type=js}
function overwriteMultiples(values, multiple, label) {
  for (let index = multiple - 1; index < values.length; index += multiple) {
    values[index] = label;
  }
}
```

## Main program

The final chunk reads in narrative order while its references pull the pieces
above into the generated file.

```javascript {.ravel #program--main type=js pipe="dedent()"}
  _"program:initial-array.js"

  _"format-output.js"

  _"program:helpers.js"

  overwriteMultiples(values, 3, "Fizz");
  overwriteMultiples(values, 5, "Buzz");
  overwriteMultiples(values, 15, "FizzBuzz");

  console.log(formatOutput(values));
```
