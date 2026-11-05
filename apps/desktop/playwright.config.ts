import { RUN_DIR } from "./e2e/run-dir.ts";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results",
  reporter: "list",
  timeout: 60_000,
  workers: 1,
  // Stops and names any hc process the run left, an app's or a spec's scratch session (#470).
  globalTeardown: "./e2e/leftover-cores.ts",
  // Where this run's apps and scratch sessions keep their files; the teardown stops any hc process still holding one.
  metadata: { runDir: RUN_DIR },
});
