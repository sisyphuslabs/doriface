import { afterAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { liveDescendants, liveWithEnvironment } from "../support/processes.ts";
import { type RelayedHost, startRelayedHost } from "../support/relayed-host.ts";

// Not a *.test.ts: relayed-host.test.ts runs it by path. It stops a relayed host the way the relay test files do, from
// an afterAll, with the relay's processes below wrangler stopped (SIGSTOP), so the relay part of the stop has to
// escalate to SIGKILL: the longest stop a relayed host's teardown allows.
let relayed: RelayedHost | undefined;

afterAll(() => relayed?.stop());

const parentOf = (pid: number): number => {
  const ps = Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(pid)], { stdout: "pipe" });
  return Number(ps.stdout.toString().trim());
};

test("starts a relayed host whose relay ignores SIGTERM", async () => {
  relayed = await startRelayedHost("stop-escalates");
  const below = new Set(await liveDescendants(process.pid));
  const relayTree = (await liveWithEnvironment("WRANGLER_LOG_PATH=")).filter((pid) => below.has(pid));
  const stopped = relayTree.filter((pid) => parentOf(pid) !== process.pid);
  expect(stopped.length).toBeGreaterThanOrEqual(2);
  const socket = relayed.session.env["HC_SOCKET"];
  writeFileSync(`${process.env["TMPDIR"]}/left.json`, JSON.stringify({ pids: relayTree, socket }));
  for (const pid of stopped) process.kill(pid, "SIGSTOP");
}, 120_000);
