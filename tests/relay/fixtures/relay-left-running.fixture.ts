import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { liveDescendants } from "../support/processes.ts";
import { startLocalRelay } from "../support/relay-dev.ts";

test("starts a relay and never stops it", async () => {
  await startLocalRelay();
  const pids = await liveDescendants(process.pid);
  expect(pids.length).toBeGreaterThanOrEqual(3);
  writeFileSync(`${process.env["TMPDIR"]}/pids.json`, JSON.stringify(pids));
}, 120_000);
