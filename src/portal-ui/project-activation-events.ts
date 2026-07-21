export const PROJECT_INACTIVITY_MS = 5 * 60 * 1_000;

export const interactionNeedsActivation = (
  lastActivityAt: number,
  currentActivityAt: number,
  thresholdMs = PROJECT_INACTIVITY_MS,
): boolean => currentActivityAt - lastActivityAt >= thresholdMs;

export const manualActionOwnsActivation = (event: Event): boolean =>
  event.target instanceof Element &&
  event.target.closest('[data-project-activation-action="manual"]') !== null;

type DeferredActivation = Readonly<{
  cancel: () => void;
  schedule: () => void;
}>;

export const createDeferredActivation = (run: () => void): DeferredActivation => {
  let frameId: number | undefined;
  const cancel = () => {
    if (frameId === undefined) return;
    window.cancelAnimationFrame(frameId);
    frameId = undefined;
  };
  const schedule = () => {
    if (frameId !== undefined) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = undefined;
      run();
    });
  };
  return { cancel, schedule };
};
