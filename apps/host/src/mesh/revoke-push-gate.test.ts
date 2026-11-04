import { describe, expect, test } from "bun:test";
import type { Signed } from "@doriface/mesh";
import { GOSSIP_TIMINGS } from "./gossip.ts";
import { FakeClock, seededRandom, settle } from "./testing/fake-clock.ts";
import { meshOf, peer } from "./testing/mesh-peers.ts";
import { MeshNet, type NetHost } from "./testing/mesh-net.ts";

function pair(): { clock: FakeClock; mesh: MeshNet; a: NetHost; b: NetHost } {
  const clock = new FakeClock();
  const mesh = new MeshNet(clock, seededRandom(7));
  const members = [peer("a"), peer("b")];
  const { records } = meshOf(members);
  const [a, b] = members.map((member) => mesh.add(member, records));
  if (a === undefined || b === undefined) throw new Error("no hosts");
  return { clock, mesh, a, b };
}

const holds = (host: NetHost, record: Signed) => (): boolean =>
  host.records().some((held) => held.body === record.body);

const revokeOf = (by: NetHost, subject: NetHost): Signed =>
  by.write("revoke", { signPubs: [subject.member.signPub], reason: "revoke" });

describe("the revoke push to a member that just went offline (section 5.3)", () => {
  test("a record a member sent is not owed back to it, so its ack starts no dial to it", async () => {
    const { a, b } = pair();
    await b.gossip.sync(a.member, "push");
    await settle();
    const ack = b.write("ack");
    await settle();
    expect(holds(a, ack)()).toBe(true);
    expect(a.gossip.owed().map((member) => member.name)).toEqual([]);
  });

  test("a member offline right after its ack still gets the revoke at its release, once it is back", async () => {
    const { clock, mesh, a, b } = pair();
    await b.gossip.sync(a.member, "push");
    await settle();
    b.write("ack");
    await settle();
    mesh.offline("b");
    // The presence the ack's session showed is served after its 0-2 s jitter, while b is already gone.
    await clock.advance(2_500);
    const revoke = revokeOf(a, b);
    await clock.advance(1_000);
    mesh.online("b");
    const took = 1_000 + (await clock.until(holds(b, revoke), GOSSIP_TIMINGS.revokedLastMs));
    expect(took).toBeLessThanOrEqual(GOSSIP_TIMINGS.revokedLastMs + 1_000);
  });
});
