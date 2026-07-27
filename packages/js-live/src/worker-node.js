import { parentPort } from "node:worker_threads";
import { startWorkerRuntime } from "./worker-runtime.js";

if (!parentPort) throw new Error("The QuickJS Node worker requires a parent port.");

await startWorkerRuntime({
  post: (message) => parentPort.postMessage(message),
  listen: (listener) => parentPort.on("message", listener)
});
