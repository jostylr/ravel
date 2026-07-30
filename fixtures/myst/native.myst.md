---
kernelspec:
  name: python3
  display_name: Python 3
---

# MyST Ravel example

:::{ravel:piece} main | trim()
:language: python
:caption: Main program
:label: lp-main

print(_"format-greeting")
:::

The implementation is [](#lp-main), also available as
{ref}`Main program <lp-main>` or @lp-main.

```{code-block} python
:label: lp-format-greeting
:caption: Greeting formatter

def format_greeting():
    return "hello"
```

```{code-cell} python
:label: lp-analysis
:caption: Analysis cell
:tags: [hide-output, raises-exception]

print(format_greeting())
```
