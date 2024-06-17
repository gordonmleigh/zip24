export type AbortListener = (reason: unknown) => void;

export function addAbortListener(
  abortSignal: AbortSignal,
  listener: AbortListener,
): () => void {
  function onAbort() {
    listener(abortSignal.reason);
  }

  if (abortSignal.aborted) {
    // run on next tick
    void Promise.resolve().then(onAbort);
    /* c8 ignore next */
    return () => {};
  }

  abortSignal.addEventListener("abort", onAbort, { once: true });

  return () => {
    abortSignal.removeEventListener("abort", onAbort);
  };
}
