---
ravel:
  document: entry
---

```ravel
in("imported-library.md")
create("main.js", compose(_"library::helper.js"))
out("dist/main.js", _"main.js")
```
