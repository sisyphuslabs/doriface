// Global teardown: every hc process still holding a file under this run's dir (see run-dir.ts) outlived the spec that
// started it, a launched app's local host or a scratch session whose dispose did not run. Stop them and fail the run
// naming them, as the host tests' guard does (#232, #470).
import { sweepRunDir } from "@doriface/host/testing/run-dir";

export default async function leftoverCores(): Promise<void> {
  const left = await sweepRunDir();
  if (left.length > 0)
    throw new Error(`hc processes outlived the desktop e2e run (now stopped):\n  ${left.join("\n  ")}`);
}
