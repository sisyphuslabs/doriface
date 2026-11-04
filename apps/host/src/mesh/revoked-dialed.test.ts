import { describe, expect, test } from "bun:test";
import { CloseCode } from "@doriface/crypto";
import { memoryLinkPair } from "@doriface/crypto/testing";
import type { MeshLine } from "./lines.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { headsOfRecords, meshOf, peer } from "./testing/mesh-peers.ts";
import { MeshNet } from "./testing/mesh-net.ts";

/** docs/transport.md: a sync session closes after 60 s without a line. */
const LINGER_MS = 60_000;
const KEEP_ALIVE_MS = 10_000;

describe("a sync session this host dialed to a member that is then revoked (section 6.2)", () => {
  test("ends within 60 s of the revoke, however often the revoked peer keeps it busy, and closes 4401", async () => {
    const [a, b, c] = [peer("a"), peer("b"), peer("c")];
    const clock = new FakeClock();
    const net = new MeshNet(clock, seededRandom(81));
    const { records } = meshOf([a, b, c]);
    const [atA, atB] = [net.add(a, records), net.add(b, records)];
    const [ours, theirs] = memoryLinkPair(true);
    atB.gossip.attach(c.signPub, b.signPub, ours);
    let closedAt: number | undefined;
    ours.onClose(() => {
      closedAt = clock.now();
    });
    const mesh = atB.gossip.meshId;
    const hello = (): void =>
      theirs.send(
        new TextEncoder().encode(
          `${JSON.stringify({ t: "hello", v: 2, mesh, heads: headsOfRecords(records), n: {} } satisfies MeshLine)}\n`,
        ),
      );
    hello();
    atA.gossip.append({ type: "revoke", signPubs: [c.signPub], reason: "revoke" });
    await clock.until(() => !atB.names().includes("c"), 5_000, 10);
    const merged = clock.now();
    const keepBusy = async (left: number): Promise<void> => {
      if (left <= 0 || closedAt !== undefined) return;
      hello();
      await clock.advance(KEEP_ALIVE_MS);
      return keepBusy(left - KEEP_ALIVE_MS);
    };
    await keepBusy(LINGER_MS + 3 * KEEP_ALIVE_MS);
    expect(closedAt).toBeDefined();
    expect((closedAt ?? Number.POSITIVE_INFINITY) - merged).toBeLessThanOrEqual(LINGER_MS);
    expect(ours.closeCode).toBe(CloseCode.UnknownDevice);
  });
});
