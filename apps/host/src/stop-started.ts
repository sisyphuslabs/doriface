/** A part a starting host has started, and how to stop it if a later step fails. */
export interface StartedPart {
  readonly name: string;
  readonly stop: () => unknown;
}

/** How long one part may take to stop while a failed start is undone, so a hung stop cannot hold the startup error. */
export const STOP_BOUND_MS = 5_000;

/**
 * Stops the parts a failed start had started, latest first. A stop that throws is logged and one that has not settled
 * within `boundMs` is logged and left; either way the rest still stop, and this settles.
 */
export function stopStarted(
  parts: readonly StartedPart[],
  log: (line: string) => void,
  boundMs: number = STOP_BOUND_MS,
): Promise<void> {
  return parts.toReversed().reduce<Promise<void>>(async (previous, part) => {
    await previous;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), boundMs);
    });
    try {
      const stopped = Promise.resolve().then(part.stop);
      if ((await Promise.race([stopped, bound])) === "timeout") {
        log(`startup: the ${part.name} did not stop within ${boundMs} ms; leaving it`);
      }
    } catch (error) {
      log(`startup: stopping the ${part.name} failed: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }, Promise.resolve());
}
