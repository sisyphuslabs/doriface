/**
 * Teardown registered while a test runs and executed after it, so a failed assertion cannot leak a live uplink or
 * socket into the next test. Each test file that uses the helpers registers `afterEach(runDeferred)`.
 */
const steps: (() => unknown)[] = [];

export function defer(step: () => unknown): void {
  steps.push(step);
}

export async function runDeferred(): Promise<void> {
  const due = steps.splice(0).toReversed();
  await due.reduce<Promise<unknown>>((previous, step) => previous.then(step).catch(() => undefined), Promise.resolve());
}
