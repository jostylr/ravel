import { diagnostic } from "./analyzer.js";
import { executeQuickJS, prepareQuickJS } from "./engine.js";

export const startWorkerRuntime = async ({ post, listen }) => {
  try {
    await prepareQuickJS();
    post({ type: "ready" });
  } catch (error) {
    post({
      type: "startup-error",
      message: error?.message ?? String(error)
    });
    return;
  }

  let configuration = { options: {}, modules: {} };
  listen(async (message) => {
    if (message?.type === "configure") {
      configuration = {
        options: message.options ?? {},
        modules: message.modules ?? {}
      };
      post({ type: "configured" });
      return;
    }
    if (message?.type !== "execute") return;
    const { executionId, request } = message;
    post({ type: "started", executionId });
    let outcome;
    try {
      outcome = await executeQuickJS({
        request,
        options: configuration.options,
        modules: configuration.modules
      });
    } catch (error) {
      outcome = {
        ok: false,
        hasExport: false,
        diagnostics: [diagnostic(
          "RJL130",
          "QuickJS worker failed: " + (error?.message ?? String(error)),
          request.sourceLocation
        )]
      };
    }
    post({ type: "result", executionId, outcome });
  });
};
