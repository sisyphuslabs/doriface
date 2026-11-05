import { afterAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { liveDescendants } from "../support/processes.ts";
import { type LocalRelay, startLocalRelay, RELAY_STOP_MS } from "../support/relay-dev.ts";

// Not a *.test.ts: relay-dev.test.ts runs it by path. It stops its relay the way every relay test file does, from an
// afterAll, but with the processes below wrangler stopped (SIGSTOP), so the stop has to escalate to SIGKILL: the
// longest stop the relay's own teardown allows.
let relay: LocalRelay | undefined;

afterAll(() => relay?.stop(), RELAY_STOP_MS);

test("starts a relay whose processes ignore SIGTERM", async () => {
  relay = await startLocalRelay();
  const pids = await liveDescendants(process.pid);
  expect(pids.length).toBeGreaterThanOrEqual(3);
  writeFileSync(`${process.env["TMPDIR"]}/pids.json`, JSON.stringify(pids));
  for (const pid of pids.slice(1)) process.kill(pid, "SIGSTOP");
}, 120_000);
