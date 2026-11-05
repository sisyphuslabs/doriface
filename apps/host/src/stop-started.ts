/** A part a starting host has started, and how to stop it if a later step fails. */
export interface StartedPart {
  readonly name: string;
  readonly stop: () => unknown;
  /** Ends by force what `stop` has not ended by the deadline (a child that ignores EOF and TERM); names what it killed. */
  readonly kill?: () => readonly string[];
}

/** How long the whole unwind of a failed start may take, so a hung stop cannot hold the startup error. */
export const UNWIND_DEADLINE_MS = 5_000;
/** How long a killed part may take to finish stopping, so its child is reaped before the startup error exits. */
export const KILL_GRACE_MS = 1_000;

/** One turn of the event loop, after the microtasks queued so far. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface StopStartedOptions {
  readonly deadlineMs?: number;
  /** Settles when the deadline has passed; a test passes one it controls instead of waiting `deadlineMs`. */
  readonly expired?: Promise<unknown>;
  readonly graceMs?: number;
}

/**
 * Stops the parts a failed start had started, latest first, within one deadline for the whole unwind. A stop that
 * throws is logged. A part still stopping at the deadline is killed if it can be (its child, by pid) and otherwise
 * left, and either is logged; a failure it reports later is logged too. The rest still stop, and this settles.
 */
export async function stopStarted(
  parts: readonly StartedPart[],
  log: (line: string) => void,
  options: StopStartedOptions = {},
): Promise<void> {
  const deadlineMs = options.deadlineMs ?? UNWIND_DEADLINE_MS;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const after = (ms: number) =>
    new Promise<void>((resolve) => {
      timers.push(setTimeout(resolve, ms));
    });
  const expired = options.expired ?? after(deadlineMs);
  const stopOne = async (part: StartedPart): Promise<void> => {
    let settled = false;
    const stopped = Promise.resolve()
      .then(part.stop)
      .finally(() => {
        settled = true;
      });
    try {
      // Past the deadline a stop still gets one turn, so one that settles at once is not reported as hung.
      await Promise.race([stopped, expired.then(turn)]);
    } catch (error) {
      log(`startup: stopping the ${part.name} failed: ${String(error)}`);
      return;
    }
    if (settled) return;
    stopped.catch((error: unknown) => log(`startup: the ${part.name} failed after the deadline: ${String(error)}`));
    const killed = part.kill?.() ?? [];
    if (killed.length === 0) {
      log(`startup: the ${part.name} did not stop by the ${deadlineMs} ms deadline; leaving it`);
      return;
    }
    log(`startup: the ${part.name} did not stop by the ${deadlineMs} ms deadline; killed ${killed.join(", ")}`);
    await Promise.race([stopped.catch(() => undefined), after(options.graceMs ?? KILL_GRACE_MS)]);
  };
  try {
    await parts.toReversed().reduce<Promise<void>>(async (previous, part) => {
      await previous;
      await stopOne(part);
    }, Promise.resolve());
  } finally {
    for (const timer of timers) clearTimeout(timer);
  }
}
