---
ravel:
  document: handbook
---

# Compiler

```typescript {.ravel #compiler--what type=ts .greedy .browser pipe="dedent() | emit('.js')"}
export const compile = () => "first";
```

```typescript
export const parse = () => "second";
```

```typescript {.end}
export const finish = () => "third";
```

```javascript {.ravel #main}
_"compiler:what.ts"
```

```text {.no-ravel}
An ordinary example in a primary-Ravel document.
```
