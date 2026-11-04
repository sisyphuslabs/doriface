import { describe, expect, test } from "bun:test";
import { CloseCode } from "@doriface/crypto";
import { type MemoryEnd, memoryLinkPair } from "@doriface/crypto/testing";
import { hashOf, type Signed } from "@doriface/mesh";
import type { MeshLine } from "./lines.ts";
import { ANSWER_MS } from "./sync.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { headsOfRecords, meshOf, peer, Signer } from "./testing/mesh-peers.ts";
import { MeshNet } from "./testing/mesh-net.ts";

const [a, b] = [peer("a"), peer("b")];
const say = (end: MemoryEnd, line: MeshLine): void => end.send(new TextEncoder().encode(`${JSON.stringify(line)}\n`));

/** b's mesh with a; a dials b, so b says hello and is owed a `done`. The test answers for a, one record at a time. */
function answeringA(seed: number) {
  const { records } = meshOf([a, b]);
  const clock = new FakeClock();
  const host = new MeshNet(clock, seededRandom(seed)).add(b, records);
  const [ours, theirs] = memoryLinkPair(true);
  host.gossip.attach(a.signPub, a.signPub, ours);
  const mesh = host.gossip.meshId;
  say(theirs, { t: "hello", v: 2, mesh, heads: headsOfRecords(records), n: {} });
  const signer = new Signer(a, records);
  const sent: Signed[] = [];
  let heads = headsOfRecords(records);
  /** One `records` line every `every` ms, `count` of them. */
  const trickle = async (count: number, every: number): Promise<void> => {
    if (count === 0) return;
    const record = signer.name(heads, `a${sent.length}`);
    heads = [hashOf(record)];
    sent.push(record);
    say(theirs, { t: "records", records: [record] });
    await clock.advance(every);
    return trickle(count - 1, every);
  };
  const stored = (): boolean => sent.every((record) => host.records().map(hashOf).includes(hashOf(record)));
  return { clock, ours, trickle, stored, done: () => say(theirs, { t: "done", mesh }) };
}

describe("the answer a hello is owed (section 5.2, H-1)", () => {
  test("an answer that keeps delivering records lines is never cut, however long it takes, and lands whole", async () => {
    const s = answeringA(71);
    await s.trickle(5, 20_000);
    expect(s.ours.closeCode).toBeUndefined();
    s.done();
    await s.clock.advance(1);
    expect(s.stored()).toBe(true);
    expect(s.ours.closeCode).toBeUndefined();
  });

  test("an answer that stops delivering is closed 4400 30 s after its last records line", async () => {
    const s = answeringA(72);
    await s.trickle(2, 20_000);
    await s.clock.advance(ANSWER_MS - 20_000 - 1);
    expect(s.ours.closeCode).toBeUndefined();
    await s.clock.advance(1);
    expect(s.ours.closeCode).toBe(CloseCode.CryptoFailure);
  });
});
