export const runtimeContractFailures = (globals = globalThis) => {
  const required = ["URL", "TextEncoder", "TextDecoder", "AbortController"];
  return required.filter((api) => typeof globals[api] !== "function");
};
