export const waitForPromiseOrAbort = async (promise, signal) => {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  const interrupted = new Promise((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new DOMException(
      "The editor language request was cancelled.",
      "AbortError"
    ));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
};

export const hasCurrentRequestAuthority = ({
  project,
  activeProject,
  requestGeneration,
  currentGeneration,
  refreshPending,
  sourceStateCurrent
}) => Boolean(
  project &&
  project === activeProject &&
  refreshPending === false &&
  requestGeneration === currentGeneration &&
  sourceStateCurrent === true
);

export const hasCurrentProjectionSourceVersion = ({
  projectionSourceVersions,
  projectSourceVersions,
  sourceUri,
  documentVersion
}) => Boolean(
  typeof sourceUri === "string" &&
  Number.isInteger(documentVersion) &&
  projectionSourceVersions?.[sourceUri] === documentVersion &&
  projectSourceVersions?.[sourceUri] === documentVersion
);

const routingIdentityKeys = [
  "projectionId",
  "targetId",
  "artifactId",
  "occurrenceId"
];

/** A refreshed project may replace object identity, but never routing identity. */
export const hasSameLanguageRoutingContext = (expected, resolved) =>
  routingIdentityKeys.every((key) =>
    expected?.[key] === undefined || expected[key] === resolved?.[key]
  );
