import { beforeEach } from "bun:test";

/**
 * Runs `setUp` once, before the file's first test. bun reports a failing `beforeAll` as "(unnamed)"; a failure here
 * fails the first test under its own name with the error, and every later test with a pointer back to it.
 */
export function setUpOnce(setUp: () => Promise<void>, timeoutMs: number): void {
  let started: Promise<void> | undefined;
  beforeEach(() => {
    if (started === undefined) {
      started = setUp();
      return started;
    }
    return started.catch((error: unknown) => {
      throw new Error("this file's set-up failed before its first test; that test carries the error", {
        cause: error,
      });
    });
  }, timeoutMs);
}
