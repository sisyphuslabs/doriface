import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostSync } from "./host-sync.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { meshOf, peer, storeOf } from "./testing/mesh-peers.ts";

/** The relay must open a member dial's socket within 10 s (`CONNECT_MS` in host-sync.ts). */
const CONNECT_MS = 10_000;
/** A loopback listener that takes the TCP connection and never answers the upgrade: a stalled relay. */
const stalled = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => undefined } });
afterAll(() => stalled.stop(true));

describe("a member dial to a relay that never opens the socket (L-E1)", () => {
  test("fails after the connect deadline instead of pinning the member's dial", async () => {
    const [a, b] = [peer("a"), peer("b")];
    const clock = new FakeClock();
    const logs: string[] = [];
    const sync = new HostSync({
      identity: b.machine.identity,
      mesh: storeOf(b, meshOf([a, b]).records),
      relay: { url: `ws://127.0.0.1:${stalled.port}` },
      hc: { hc: "hc-not-installed" },
      stateDir: mkdtempSync(join(tmpdir(), "dh-host-sync-")),
      program: "/opt/doriface-host",
      openFrom: () => false,
      closeRevoked: () => undefined,
      log: (line) => void logs.push(line),
      clock,
      random: seededRandom(47),
    });
    sync.changed();
    await clock.advance(CONNECT_MS - 1);
    const failed = (): readonly string[] => logs.filter((line) => line.includes("did not open the socket"));
    expect(failed()).toEqual([]);
    await clock.advance(1);
    expect(failed()).toHaveLength(1);
    await sync.stop();
  });
});
