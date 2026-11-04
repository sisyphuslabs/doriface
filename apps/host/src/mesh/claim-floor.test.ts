import { describe, expect, test } from "bun:test";
import { CloseCode } from "@doriface/crypto";
import { memoryLinkPair } from "@doriface/crypto/testing";
import { parseRecord } from "@doriface/mesh";
import { CounterBehindError } from "../state/mesh.ts";
import type { MeshLine } from "./lines.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { headsOfRecords, meshOf, peer } from "./testing/mesh-peers.ts";
import { MeshNet } from "./testing/mesh-net.ts";

const [a, b] = [peer("a"), peer("b")];
const revoke = { type: "revoke", signPubs: [a.signPub], reason: "revoke" } as const;
const KEEP_ALIVE_MS = 10_000;
/** docs/transport.md: a side owed a `done` closes the session 4400 after 30 s without one. */
const ANSWER_MS = 30_000;
const CLAIM = { [b.signPub]: Number.MAX_SAFE_INTEGER };

/** b's mesh with a, and a sync session a opened to b; the test speaks for a and reads what b says back. */
function sessionAtB(seed: number) {
  const { records } = meshOf([a, b]);
  const clock = new FakeClock();
  const host = new MeshNet(clock, seededRandom(seed)).add(b, records);
  const [ours, theirs] = memoryLinkPair(true);
  const toA: MeshLine[] = [];
  const decoder = new TextDecoder();
  ours.tap = (bytes) => {
    for (const text of decoder.decode(bytes).split("\n").filter(Boolean)) toA.push(JSON.parse(text));
    return [bytes];
  };
  host.gossip.attach(a.signPub, a.signPub, ours);
  const mesh = host.gossip.meshId;
  const say = (line: MeshLine): void => theirs.send(new TextEncoder().encode(`${JSON.stringify(line)}\n`));
  const hello = (n: Readonly<Record<string, number>>): void =>
    say({ t: "hello", v: 2, mesh, heads: headsOfRecords(records), n });
  const ownNs = (): readonly number[] =>
    (host.store.read()?.records ?? []).flatMap((record) => {
      const body = parseRecord(record);
      return body?.by === b.signPub ? [body.n] : [];
    });
  return { clock, host, ours, toA, hello, done: () => say({ t: "done", mesh }), ownNs };
}

/** Says the claim again every 10 s, keeping the session well inside its 60 s linger, for `ms` of virtual time. */
async function claimFor(s: ReturnType<typeof sessionAtB>, ms: number): Promise<void> {
  s.hello(CLAIM);
  if (ms <= KEEP_ALIVE_MS) return s.clock.advance(ms);
  await s.clock.advance(KEEP_ALIVE_MS);
  return claimFor(s, ms - KEEP_ALIVE_MS);
}

describe("a peer's hello.n claim on this host's counter (section 10.1, M-E1)", () => {
  test("is resolved by the claimer's next done, even a done that brings no records", async () => {
    const s = sessionAtB(51);
    s.hello({ [b.signPub]: 7 });
    await s.clock.advance(1);
    expect(() => s.host.gossip.append(revoke)).toThrow(CounterBehindError);
    s.done();
    await s.clock.advance(1);
    s.host.gossip.append(revoke);
    expect(s.ownNs()).toEqual([1]);
  });

  test.each([
    ["claims in its first hello", 0],
    ["answers this host's hello, then claims in a later one", 20_000],
  ] satisfies [string, number][])(
    "a claimer that %s and keeps the session up with hellos but never sends done is closed 4400",
    async (_, at) => {
      const s = sessionAtB(52);
      if (at > 0) {
        s.done();
        await s.clock.advance(at);
      }
      await claimFor(s, ANSWER_MS - 1);
      expect(s.ours.closeCode).toBeUndefined();
      await s.clock.advance(1);
      expect(s.ours.closeCode).toBe(CloseCode.CryptoFailure);
      s.host.gossip.append(revoke);
      expect(s.ownNs()).toEqual([1]);
    },
  );

  test("every hello is answered with done, even when the peer lacks nothing, so an honest peer always resolves", async () => {
    const s = sessionAtB(53);
    s.hello({});
    await s.clock.advance(1);
    expect(s.toA.map((line) => line.t)).toEqual(["hello", "done"]);
  });
});
