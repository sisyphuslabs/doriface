/** Runs every step in order, even after one fails, and returns the failures. */
export async function settleAll(steps: readonly (() => unknown)[]): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- a teardown runs its steps in order: the host before its core and relay
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

/** A setup error, with the errors of the teardown that followed it. */
export type SetupError = Error & { teardown?: readonly unknown[] };

/** Tears down after a failed setup, then rethrows the setup error itself, with any teardown failures attached to it. */
export async function rethrowAfter(error: unknown, teardown: readonly (() => unknown)[]): Promise<never> {
  const failures = await settleAll(teardown);
  if (failures.length > 0 && error instanceof Error) (error as SetupError).teardown = failures;
  throw error;
}
