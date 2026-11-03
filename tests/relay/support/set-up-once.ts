import { beforeEach } from "bun:test";

/**
 * Runs `setUp` once, before the file's first test. bun reports a failing `beforeAll` as "(unnamed)"; a failure here
 * fails the first test under its own name with the error, and every later test with a pointer back to it. A set-up
 * still unsettled when the first test timed out fails each later test at once instead of making it wait again.
 */
export function setUpOnce(setUp: () => Promise<void>, timeoutMs: number): void {
  let started: Promise<void> | undefined;
  let settled = false;
  beforeEach(() => {
    if (started === undefined) {
      started = Promise.resolve()
        .then(setUp)
        .finally(() => {
          settled = true;
        });
      return started;
    }
    if (!settled) throw new Error(`this file's set-up did not finish within the first test's ${timeoutMs} ms`);
    return started.catch((error: unknown) => {
      throw new Error("this file's set-up failed before its first test; that test carries the error", {
        cause: error,
      });
    });
  }, timeoutMs);
}
