import { analyzeJavaScript, diagnostic } from "./analyzer.js";

const providerId = "quickjs-wasm-worker";
const providerVersion = "0.2.0-dev";

const moduleEntries = (modules) => {
  if (modules instanceof Map) return [...modules.entries()];
  if (modules && typeof modules === "object") return Object.entries(modules);
  return [];
};

const normalizeModules = (modules, options) => {
  const entries = moduleEntries(modules).map(([specifier, value]) => {
    const source = typeof value === "string" ? value : value?.source;
    if (typeof specifier !== "string" || !specifier ||
        typeof source !== "string") {
      throw new TypeError("Live JavaScript modules require a non-empty specifier and source string.");
    }
    return [specifier, source];
  });
  const maximumEntries = options.moduleEntries ?? 100;
  if (entries.length > maximumEntries) {
    throw new RangeError("Live JavaScript module registry exceeds " + maximumEntries + " entries.");
  }
  const maximumBytes = options.moduleBytes ?? 8 * 1024 * 1024;
  const bytes = entries.reduce(
    (total, [specifier, source]) =>
      total + new TextEncoder().encode(specifier).byteLength +
      new TextEncoder().encode(source).byteLength,
    0
  );
  if (bytes > maximumBytes) {
    throw new RangeError("Live JavaScript module registry exceeds " + maximumBytes + " bytes.");
  }
  return Object.fromEntries(entries);
};

const engineOptions = (options) => ({
  timeoutMs: options.timeoutMs,
  memoryBytes: options.memoryBytes,
  stackBytes: options.stackBytes,
  outputBytes: options.outputBytes
});

const isNodeLike = () =>
  globalThis.process?.release?.name === "node" ||
  typeof globalThis.Bun?.version === "string";

const createDefaultWorker = async () => {
  if (isNodeLike()) {
    const workerThreadsSpecifier = "node:" + "worker_threads";
    const { Worker } = await import(workerThreadsSpecifier);
    return new Worker(new URL("./worker-node.js", import.meta.url), {
      type: "module",
      name: "ravel-quickjs",
      // Test runners, profilers, and `node --input-type` can inject flags that
      // are invalid for file-backed workers. The sandbox worker needs none of
      // the parent's Node execution flags.
      execArgv: []
    });
  }
  if (typeof globalThis.Worker === "function") {
    return new globalThis.Worker(new URL("./worker-browser.js", import.meta.url), {
      type: "module",
      name: "ravel-quickjs"
    });
  }
  throw new Error("This host does not provide a supported Worker implementation.");
};

const workerMessage = (worker, listener) => {
  if (typeof worker.addEventListener === "function") {
    const wrapped = (event) => listener(event.data);
    worker.addEventListener("message", wrapped);
    return () => worker.removeEventListener("message", wrapped);
  }
  worker.on("message", listener);
  return () => worker.off("message", listener);
};

const workerError = (worker, listener) => {
  if (typeof worker.addEventListener === "function") {
    const wrapped = (event) => listener(event.error ?? new Error(event.message));
    worker.addEventListener("error", wrapped);
    return () => worker.removeEventListener("error", wrapped);
  }
  worker.on("error", listener);
  return () => worker.off("error", listener);
};

const workerExit = (worker, listener) => {
  if (typeof worker.on !== "function") return () => {};
  worker.on("exit", listener);
  return () => worker.off("exit", listener);
};

const postToWorker = (worker, message) => worker.postMessage(message);

const stopWorker = async (worker) => {
  try {
    await worker.terminate();
  } catch {
    // A worker that already exited is already isolated from the host.
  }
};

const waitForWorkerConfiguration = (worker, modules, options) => new Promise((resolve, reject) => {
  let phase = "ready";
  const timeout = setTimeout(() => {
    cleanup();
    reject(new Error("QuickJS worker startup timed out."));
  }, options.workerStartupTimeoutMs ?? 15_000);
  const removeMessage = workerMessage(worker, (message) => {
    if (phase === "ready" && message?.type === "ready") {
      phase = "configured";
      postToWorker(worker, {
        type: "configure",
        modules,
        options: engineOptions(options)
      });
    } else if (phase === "configured" && message?.type === "configured") {
      cleanup();
      resolve();
    } else if (message?.type === "startup-error") {
      cleanup();
      reject(new Error(message.message));
    }
  });
  const removeError = workerError(worker, (error) => {
    cleanup();
    reject(error);
  });
  const removeExit = workerExit(worker, (code) => {
    cleanup();
    reject(new Error("QuickJS worker exited during startup with code " + code + "."));
  });
  const cleanup = () => {
    clearTimeout(timeout);
    removeMessage();
    removeError();
    removeExit();
  };
});

const failureOutcome = (code, message, source) => ({
  ok: false,
  hasExport: false,
  diagnostics: [diagnostic(code, message, source)]
});

export const createJavaScriptLiveProvider = (options = {}) => {
  const modules = normalizeModules(options.modules, options);
  const availableModules = new Set(Object.keys(modules));
  let workerPromise;
  let executionSequence = 0;
  let tail = Promise.resolve();
  let disposed = false;
  let cancelCurrent;

  const discardWorker = async () => {
    const pending = workerPromise;
    workerPromise = undefined;
    if (!pending) return;
    try {
      const worker = await pending;
      await stopWorker(worker);
    } catch {
      // Startup failures have no usable worker to retain.
    }
  };

  const workerForExecution = () => {
    if (!workerPromise) {
      const created = (async () => {
        const worker = await (options.workerFactory?.() ?? createDefaultWorker());
        try {
          await waitForWorkerConfiguration(worker, modules, options);
          worker.unref?.();
          return worker;
        } catch (error) {
          await stopWorker(worker);
          throw error;
        }
      })();
      workerPromise = created;
      created.catch(() => {
        if (workerPromise === created) workerPromise = undefined;
      });
    }
    return workerPromise;
  };

  const executeInWorker = async (request) => {
    if (disposed) {
      return failureOutcome(
        "RJL131",
        "The QuickJS worker provider has been disposed.",
        request.sourceLocation
      );
    }
    if (request.signal?.aborted) {
      return failureOutcome("RJL121", "Live JavaScript execution was cancelled.", request.sourceLocation);
    }

    let worker;
    try {
      worker = await workerForExecution();
    } catch (error) {
      return failureOutcome(
        "RJL130",
        "QuickJS worker could not start: " + (error?.message ?? String(error)),
        request.sourceLocation
      );
    }
    if (request.signal?.aborted) {
      await discardWorker();
      return failureOutcome(
        "RJL121",
        "Live JavaScript execution was cancelled and its worker was terminated.",
        request.sourceLocation
      );
    }

    worker.ref?.();
    const executionId = ++executionSequence;
    const timeoutMs = request.limits?.timeoutMs ?? options.timeoutMs ?? 1000;
    const terminationGraceMs = options.workerTerminationGraceMs ?? 100;
    const clonedRequest = { ...request };
    delete clonedRequest.signal;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (outcome, replaceWorker = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (cancelCurrent === cancelExecution) cancelCurrent = undefined;
        worker.unref?.();
        if (replaceWorker) void discardWorker();
        resolve(outcome);
      };
      const removeMessage = workerMessage(worker, (message) => {
        if (message?.type !== "result" || message.executionId !== executionId) return;
        settle(message.outcome);
      });
      const removeError = workerError(worker, (error) => {
        settle(failureOutcome(
          "RJL130",
          "QuickJS worker failed: " + (error?.message ?? String(error)),
          request.sourceLocation
        ), true);
      });
      const removeExit = workerExit(worker, (code) => {
        settle(failureOutcome(
          "RJL130",
          "QuickJS worker exited unexpectedly with code " + code + ".",
          request.sourceLocation
        ), true);
      });
      const timeout = setTimeout(() => {
        settle(failureOutcome(
          "RJL120",
          "QuickJS worker was terminated after exceeding " + timeoutMs + " ms.",
          request.sourceLocation
        ), true);
      }, timeoutMs + terminationGraceMs);
      const onAbort = () => {
        settle(failureOutcome(
          "RJL121",
          "Live JavaScript execution was cancelled and its worker was terminated.",
          request.sourceLocation
        ), true);
      };
      const cancelExecution = () => {
        settle(failureOutcome(
          "RJL131",
          "The QuickJS worker provider was disposed during execution.",
          request.sourceLocation
        ), true);
      };
      cancelCurrent = cancelExecution;
      const cleanup = () => {
        clearTimeout(timeout);
        removeMessage();
        removeError();
        removeExit();
        request.signal?.removeEventListener("abort", onAbort);
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) {
        onAbort();
        return;
      }

      try {
        postToWorker(worker, {
          type: "execute",
          executionId,
          request: clonedRequest
        });
      } catch (error) {
        settle(failureOutcome(
          "RJL130",
          "QuickJS worker request failed: " + (error?.message ?? String(error)),
          request.sourceLocation
        ), true);
      }
    });
  };

  const provider = {
    id: options.id ?? providerId,
    version: providerVersion,
    languages: options.languages ?? ["js", "javascript"],
    analyze: (request) => analyzeJavaScript({ ...request, availableModules }),
    execute: (request) => {
      const scheduled = tail.then(
        () => executeInWorker(request),
        () => executeInWorker(request)
      );
      tail = scheduled.then(() => undefined, () => undefined);
      return scheduled;
    },
    dispose: async () => {
      disposed = true;
      cancelCurrent?.();
      await tail;
      await discardWorker();
    }
  };
  return provider;
};

export const javascriptLiveProvider = createJavaScriptLiveProvider();
