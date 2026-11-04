import { describe, expect, test } from "bun:test";
import { memoryLinkPair } from "@doriface/crypto/testing";
import { hashOf, parseRecord, type Signed } from "@doriface/mesh";
import { CounterBehindError } from "../state/mesh.ts";
import type { MeshLine } from "./lines.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { headsOfRecords, meshOf, peer, Signer } from "./testing/mesh-peers.ts";
import { MeshNet } from "./testing/mesh-net.ts";

const [a, b, c] = [peer("a"), peer("b"), peer("c")];
const revoke = { type: "revoke", signPubs: [c.signPub], reason: "revoke" } as const;
const encode = (line: MeshLine): Uint8Array => new TextEncoder().encode(`${JSON.stringify(line)}\n`);

/** b holding `records`; `connect()` opens a sync session a dialed to b, and the test speaks for a on it. */
function atB(records: readonly Signed[], seed: number) {
  const clock = new FakeClock();
  const host = new MeshNet(clock, seededRandom(seed)).add(b, records);
  const mesh = host.gossip.meshId;
  const connect = (heads = headsOfRecords(records)) => {
    const [ours, theirs] = memoryLinkPair(true);
    host.gossip.attach(a.signPub, a.signPub, ours);
    const say = (line: MeshLine): void => theirs.send(encode(line));
    return { theirs, say, hello: (n: Readonly<Record<string, number>>) => say({ t: "hello", v: 2, mesh, heads, n }) };
  };
  const signs = (): boolean => {
    try {
      host.gossip.append(revoke);
      return true;
    } catch (error) {
      if (error instanceof CounterBehindError) return false;
      throw error;
    }
  };
  const ownNs = (): readonly number[] =>
    (host.store.read()?.records ?? []).flatMap((record) => {
      const body = parseRecord(record);
      return body?.by === b.signPub ? [body.n] : [];
    });
  return { clock, mesh, connect, signs, ownNs };
}

const CLAIM = { [b.signPub]: Number.MAX_SAFE_INTEGER };
type Session = ReturnType<ReturnType<typeof atB>["connect"]>;
const endings: readonly [string, (session: Session, redial: () => Session) => void][] = [
  ["closes its own session", (session) => session.theirs.close(1000, "bye")],
  ["redials, and the new session replaces it", (_session, redial) => void redial()],
  ["sends a malformed line", (session) => session.theirs.send(new TextEncoder().encode("not json\n"))],
  ["loses its transport", (session) => session.theirs.close(1006, "")],
];

describe("every way a claim ends without its done starts the 10-minute cooldown (section 10.1)", () => {
  test.each(endings)("a claimer that %s at 25 s cannot renew the claim", async (_how, end) => {
    const s = atB(meshOf([a, b, c]).records, 91);
    const first = s.connect();
    first.hello(CLAIM);
    await s.clock.advance(25_000);
    expect(s.signs()).toBe(false);
    end(first, () => s.connect());
    await s.clock.advance(1);
    s.connect().hello(CLAIM);
    await s.clock.advance(1);
    expect(s.signs()).toBe(true);
  });
});

describe("an honest restored host whose peer answers slowly (section 10.1)", () => {
  test("refuses its own records for as long as the answer makes progress, then signs past what it held: no fork", async () => {
    const { records } = meshOf([a, b, c]);
    const one = new Signer(a, records).name(headsOfRecords(records), "a2");
    const two = new Signer(a, [...records, one]).admit(peer("d"), [hashOf(one)]);
    const own = new Signer(b, records).ack([hashOf(two)]);
    const s = atB(records, 92);
    const session = s.connect([hashOf(own)]);
    const refused: boolean[] = [];
    const at = async (ms: number, act: () => void): Promise<void> => {
      await s.clock.advance(ms - s.clock.now());
      act();
    };
    session.hello({ [b.signPub]: 1 });
    await at(0, () => refused.push(!s.signs()));
    await at(10_000, () => session.say({ t: "records", records: [one] }));
    await at(29_000, () => refused.push(!s.signs()));
    await at(32_000, () => refused.push(!s.signs()));
    await at(35_000, () => session.say({ t: "records", records: [two] }));
    await at(45_000, () => session.say({ t: "records", records: [own] }));
    await at(46_000, () => session.say({ t: "done", mesh: s.mesh }));
    await s.clock.advance(1);
    expect(refused).toEqual([true, true, true]);
    expect(s.signs()).toBe(true);
    expect(s.ownNs()).toEqual([1, 2]);
  });
});
