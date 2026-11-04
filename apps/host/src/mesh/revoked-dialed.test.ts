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
  test.each([
    ["open at the revoke", false],
    ["dialed after the revoke (section 5.3's last push)", true],
  ] satisfies [string, boolean][])(
    "%s ends within 60 s, however often the revoked peer keeps it busy, and closes 4401",
    async (_when, later) => {
      const [a, b, c] = [peer("a"), peer("b"), peer("c")];
      const clock = new FakeClock();
      const net = new MeshNet(clock, seededRandom(83));
      const { records } = meshOf([a, b, c]);
      const [atA, atB] = [net.add(a, records), net.add(b, records)];
      const mesh = atB.gossip.meshId;
      const line = { t: "hello", v: 2, mesh, heads: headsOfRecords(records), n: {} } satisfies MeshLine;
      // The revoked peer answers every hello it gets, so nothing but the retirement can end the session.
      const done = { t: "done", mesh } satisfies MeshLine;
      const dial = () => {
        const [ours, theirs] = memoryLinkPair(true);
        atB.gossip.attach(c.signPub, b.signPub, ours);
        return {
          ours,
          hello: () => theirs.send(new TextEncoder().encode(`${JSON.stringify(line)}\n${JSON.stringify(done)}\n`)),
        };
      };
      const early = later ? undefined : dial();
      atA.gossip.append({ type: "revoke", signPubs: [c.signPub], reason: "revoke" });
      await clock.until(() => !atB.names().includes("c"), 5_000, 10);
      const since = clock.now();
      const session = early ?? dial();
      let closedAt: number | undefined;
      session.ours.onClose(() => {
        closedAt = clock.now();
      });
      const keepBusy = async (left: number): Promise<void> => {
        if (left <= 0 || closedAt !== undefined) return;
        session.hello();
        await clock.advance(KEEP_ALIVE_MS);
        return keepBusy(left - KEEP_ALIVE_MS);
      };
      await keepBusy(LINGER_MS + 3 * KEEP_ALIVE_MS);
      expect((closedAt ?? Number.POSITIVE_INFINITY) - since).toBeLessThanOrEqual(LINGER_MS);
      expect(session.ours.closeCode).toBe(CloseCode.UnknownDevice);
    },
  );
});

/** Thirteen members; m1 has a sync session it dialed to the one past the 12-member cap, kept busy by that member. */
function pastTheCap() {
  const peers = Array.from({ length: 13 }, (_, i) => peer(`m${i}`));
  const clock = new FakeClock();
  const net = new MeshNet(clock, seededRandom(84));
  const { records } = meshOf(peers);
  const [m0, m1] = peers;
  if (m0 === undefined || m1 === undefined) throw new Error("no members");
  const [at0, at1] = [net.add(m0, records), net.add(m1, records)];
  const [capped] = at1.gossip.view.overCap;
  const other = peers.find((member) => ![m0, m1].includes(member) && member.signPub !== capped?.signPub);
  if (capped === undefined || other === undefined) throw new Error("no member past the cap");
  const [ours, theirs] = memoryLinkPair(true);
  at1.gossip.attach(capped.signPub, m1.signPub, ours);
  let closed: { readonly at: number; readonly reason: string } | undefined;
  theirs.onClose((error) => {
    closed = { at: clock.now(), reason: error?.message ?? "" };
  });
  const line = { t: "hello", v: 2, mesh: at1.gossip.meshId, heads: headsOfRecords(records), n: {} } satisfies MeshLine;
  const done = { t: "done", mesh: at1.gossip.meshId } satisfies MeshLine;
  const keepBusy = async (left: number): Promise<void> => {
    if (left <= 0 || closed !== undefined) return;
    theirs.send(new TextEncoder().encode(`${JSON.stringify(line)}\n${JSON.stringify(done)}\n`));
    await clock.advance(KEEP_ALIVE_MS);
    return keepBusy(left - KEEP_ALIVE_MS);
  };
  return { clock, at0, at1, capped, other, ours, keepBusy, closed: () => closed };
}

describe("a sync session this host dialed to a member past the 12-member cap (section 6.2)", () => {
  test("retires within 60 s, and its close says the cap is why", async () => {
    const s = pastTheCap();
    await s.keepBusy(LINGER_MS + 3 * KEEP_ALIVE_MS);
    expect(s.closed()?.at ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(LINGER_MS);
    expect(s.closed()?.reason).toContain("12-member cap");
    expect(s.ours.closeCode).toBe(CloseCode.UnknownDevice);
  });

  test("stays open once a revoke brings that member back under the cap", async () => {
    const s = pastTheCap();
    await s.keepBusy(KEEP_ALIVE_MS);
    s.at0.gossip.append({ type: "revoke", signPubs: [s.other.signPub], reason: "revoke" });
    await s.clock.until(
      () => s.at1.gossip.view.members.some((member) => member.signPub === s.capped.signPub),
      30_000,
      10,
    );
    await s.keepBusy(2 * LINGER_MS);
    expect(s.closed()).toBeUndefined();
  });
});
