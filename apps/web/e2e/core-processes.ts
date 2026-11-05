// The hc processes an e2e host left running (its core, its added machine's core, their lines), so a host that has
// stopped can show it left none (#226). They are found as the host tests' guard finds a run's cores (#232): by the
// files they hold under the host's dir, since on macOS a core hc starts through launchd carries launchd's environment,
// with nothing in it naming the host (#470).
import { stopLeftUnder } from "@doriface/host/testing/run-dir";

const GONE_WITHIN_MS = 15_000;

/**
 * Waits for the hc processes holding files under `dir` to exit, as a core does once it is told to stop; then stops
 * those still running, and returns them as "pid args" (never an environment) so the worker fails naming them.
 */
export async function coresLeftUnder(dir: string): Promise<string[]> {
  return (await stopLeftUnder(dir, GONE_WITHIN_MS)).map(({ pid, command }) => `${pid} ${command}`);
}
