import { startWorkerRuntime } from "./worker-runtime.js";

await startWorkerRuntime({
  post: (message) => globalThis.postMessage(message),
  listen: (listener) => globalThis.addEventListener("message", (event) => listener(event.data))
});
