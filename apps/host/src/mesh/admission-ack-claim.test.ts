import { describe, expect, test } from "bun:test";
import { hashOf, parseRecord, type Signed } from "@doriface/mesh";
import { CLAIM_MS } from "./claims.ts";
import { hostB, restored } from "./testing/claim-host.ts";
import { peer } from "./testing/mesh-peers.ts";

const [a, b] = [peer("a"), peer("b")];
const ownBy = (records: readonly Signed[]): readonly Signed[] =>
  records.filter((record) => parseRecord(record)?.by === b.signPub);

// #159: a joiner's admission ack is signed only once a member's hello has been read (or no member answered within a
// claim's 30 s), so a claim on this host's counter, as a restored host meets, holds it back like any own record.
describe("the joiner's admission ack waits for a member's hello (section 10.1, #159)", () => {
  test("a restored joiner signs no admission ack before a hello, and the claimed ack it already signed arrives: no fork", async () => {
    const { records, chain, heads } = restored(1);
    const h = hostB(records, 31);
    h.gossip.ackAdmission();
    expect(h.ownNs()).toEqual([]);
    const session = h.connect(a, heads);
    session.hello({ [b.signPub]: 1 });
    await h.at(1_000);
    expect(h.ownNs()).toEqual([]);
    session.send(...chain);
    session.done();
    await h.at(2_000);
    expect(ownBy(h.stored()).map(hashOf)).toEqual(chain.map(hashOf));
  });

  test("a hello that claims nothing of this host's key lets the admission ack be signed at once", async () => {
    const { records } = restored(0);
    const h = hostB(records, 32);
    expect(h.gossip.ackAdmission()).toBe(true);
    expect(h.gossip.ackAdmission()).toBe(false);
    expect(h.ownNs()).toEqual([]);
    h.connect(a).hello({});
    await h.at(1);
    expect(h.own()).toEqual([{ n: 1, type: "ack" }]);
  });

  test("with no member's hello, the admission ack is signed once a claim's wait has passed", async () => {
    const { records } = restored(0);
    const h = hostB(records, 33);
    h.gossip.ackAdmission();
    await h.at(CLAIM_MS - 1);
    expect(h.ownNs()).toEqual([]);
    await h.at(CLAIM_MS + 1);
    expect(h.own()).toEqual([{ n: 1, type: "ack" }]);
    h.gossip.ackAdmission();
    await h.at(2 * CLAIM_MS + 2);
    expect(h.ownNs()).toEqual([1]);
  });
});
