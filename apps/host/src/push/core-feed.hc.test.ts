import type { ByteLink } from "@doriface/client";
import { expect, test } from "bun:test";
import { createHcSession } from "../testing/hc-session.ts";
import { startCoreFeed } from "./core-feed.ts";
import type { PushService } from "./push-service.ts";

const service = { attach: () => {}, baseline: () => {}, event: async () => {} } as unknown as PushService;

/** The pids of live `hc connect` children of one hc session, read from full argv. */
const hcConnectPids = (session: string): number[] =>
  Bun.spawnSync(["ps", "-axo", "pid=,args="], { stdout: "pipe" })
    .stdout.toString()
    .split("\n")
    .filter((line) => line.includes(" connect ") && line.includes(session))
    .map((line) => Number.parseInt(line.trim(), 10));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("stop settles once the feed's hc connect child has exited", async () => {
  const session = createHcSession("dh-feed-stop");
  try {
    const feed = startCoreFeed({ hc: session.hc, session: session.name, env: session.env }, service, () => {});
    await feed.ready;
    const pids = hcConnectPids(session.name);
    expect(pids).toHaveLength(1);
    await feed.stop();
    expect(pids.filter(alive)).toEqual([]);
  } finally {
    for (const pid of hcConnectPids(session.name)) process.kill(pid, "SIGTERM");
    await session.dispose();
  }
}, 30_000);

test("a connection attempt that fails closes its link before the next attempt", async () => {
  const closes = new Set<(error: Error | undefined) => void>();
  let closedByFeed = false;
  // A core that drops the line as soon as the hello is sent, so the attempt fails.
  const refusing: ByteLink = {
    send: () => queueMicrotask(() => closes.forEach((listener) => listener(new Error("the core refused the hello")))),
    onData: () => () => {},
    onClose: (listener) => {
      closes.add(listener);
      return () => closes.delete(listener);
    },
    close: () => {
      closedByFeed = true;
    },
  };
  const logs: string[] = [];
  const feed = startCoreFeed(
    { hc: "hc" },
    service,
    (line) => logs.push(line),
    () => refusing,
  );
  await feed.ready;
  expect(logs.some((line) => line.startsWith("push: cannot follow this host's core"))).toBe(true);
  expect(closedByFeed).toBe(true);
  await feed.stop();
});
