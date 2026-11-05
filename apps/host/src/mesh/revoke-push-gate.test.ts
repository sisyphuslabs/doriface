import { describe, expect, spyOn, test } from "bun:test";
import { hashOf, type Signed } from "@doriface/mesh";
import type { DialPurpose, Grant } from "./dial-policy.ts";
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

/** Dials of `purpose` to other members, queued for the budget: 12 are served now, the rest wait a window. */
const queue = (host: NetHost, purpose: DialPurpose, count = 24): Promise<Grant>[] =>
  Array.from({ length: count }, (_, index) => host.policy.acquire(`${purpose}-${index}`, purpose));

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

  test("records the door refuses never count as held, so the held set stays within the stored set", async () => {
    const { a, b } = pair();
    await b.gossip.sync(a.member, "push");
    await settle();
    const session = a.gossip.session(b.member.signPub);
    if (session === undefined) throw new Error("no session from b");
    const junk = Array.from({ length: 64 }, (_, index) => ({ body: `not a record ${index}`, sig: "AA" }));
    a.gossip.merge(session, junk);
    const held = new Set(a.gossip.held(b.member.signPub));
    expect(junk.map(hashOf).filter((hash) => held.has(hash))).toEqual([]);
    expect(held.size).toBeLessThanOrEqual(a.records().length);
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

describe("a held revoke push that meets a dial gate (sections 5.3 and 8.2)", () => {
  test("is retried when the gate's probe is due, ahead of the hc lines waiting for the budget", async () => {
    const { clock, mesh, a, b } = pair();
    mesh.offline("b");
    const revoke = revokeOf(a, b);
    await clock.advance(GOSSIP_TIMINGS.revokedLastMs + 1);
    const gate = a.policy.gate(b.member.signPub);
    expect(gate?.misses).toBe(1);
    await clock.advance(10_000);
    mesh.online("b");
    const lines = [...queue(a, "push"), ...queue(a, "line")];
    await settle();
    const dueAt = gate?.nextAt ?? 0;
    const firstWindow = clock.now() + 60_000;
    expect(dueAt).toBeLessThan(firstWindow);
    await clock.untilTimers(holds(b, revoke), firstWindow - clock.now() + 1_000);
    expect(clock.now()).toBeLessThanOrEqual(firstWindow + 1_000);
    await clock.advance(4 * 60_000);
    expect((await Promise.all(lines)).every((grant) => grant.ok)).toBe(true);
  });
});

describe("the released revoke push (sections 5.3 and 8.2)", () => {
  test("goes ahead of the other pushes waiting for the budget", async () => {
    const { clock, a, b } = pair();
    const pushes = queue(a, "push");
    const revoke = revokeOf(a, b);
    const took = await clock.untilTimers(holds(b, revoke), 120_000);
    expect(took).toBeLessThanOrEqual(61_000);
    await clock.advance(120_000);
    expect((await Promise.all(pushes)).every((grant) => grant.ok)).toBe(true);
  });

  test("dials no one when the revoked member already holds the revoke", async () => {
    const { clock, mesh, a, b } = pair();
    const revoke = revokeOf(a, b);
    await b.gossip.sync(a.member, "push");
    await settle();
    expect(holds(b, revoke)()).toBe(true);
    mesh.offline("b");
    mesh.online("b");
    const before = a.dials.length;
    await clock.advance(GOSSIP_TIMINGS.revokedLastMs + 1);
    expect(a.dials.slice(before)).toEqual([]);
  });

  test("once delivered, a later record to the member goes as an ordinary push", async () => {
    const { clock, mesh, a, b } = pair();
    mesh.offline("b");
    const revoke = revokeOf(a, b);
    await clock.advance(GOSSIP_TIMINGS.revokedLastMs + 1);
    mesh.online("b");
    await clock.untilTimers(holds(b, revoke), 60_000);
    const purposes: DialPurpose[] = [];
    const acquire = a.policy.acquire.bind(a.policy);
    spyOn(a.policy, "acquire").mockImplementation((member, purpose, options) => {
      if (member === b.member.signPub) purposes.push(purpose);
      return acquire(member, purpose, options);
    });
    mesh.offline("b");
    a.write("ack");
    await clock.advance(120_000);
    expect(purposes.length).toBeGreaterThan(0);
    expect(purposes.filter((purpose) => purpose === "revoke-push")).toEqual([]);
  });
});
