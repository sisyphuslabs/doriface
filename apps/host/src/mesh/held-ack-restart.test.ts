import { describe, expect, test } from "bun:test";
import { hostB, restored } from "./testing/claim-host.ts";
import { headsOfRecords, peer, Signer } from "./testing/mesh-peers.ts";

const [a, b] = [peer("a"), peer("b")];

describe("an ack a claim held back survives a restart (section 10.1, #156)", () => {
  test("held under a claim, b restarts on the same store; once the claim resolves the ack is signed, exactly once", async () => {
    const { records, chain, heads } = restored(1);
    const admit = new Signer(a, records).admit(peer("d"), headsOfRecords(records));
    const h = hostB(records, 51);
    const before = h.connect(a, heads);
    before.hello({ [b.signPub]: 1 });
    await h.at(1_000);
    before.send(admit);
    before.done();
    await h.at(2_000);
    expect(h.ownNs()).toEqual([]);

    h.restart();
    const after = h.connect(a, heads);
    after.hello({ [b.signPub]: 1 });
    await h.at(3_000);
    expect(h.ownNs()).toEqual([]);
    after.send(...chain);
    after.done();
    await h.at(4_000);
    expect(h.own()).toEqual([
      { n: 1, type: "ack" },
      { n: 2, type: "ack" },
    ]);
    await h.at(40_000);
    expect(h.ownNs()).toEqual([1, 2]);
  });

  test("held under a claim, b restarts and the claim lapses with no hello: the ack is signed after a claim's wait, once", async () => {
    const { records, heads } = restored(0);
    const admit = new Signer(a, records).admit(peer("d"), headsOfRecords(records));
    const h = hostB(records, 52);
    const before = h.connect(a, heads);
    before.hello({ [b.signPub]: 3 });
    await h.at(1_000);
    before.send(admit);
    before.done();
    await h.at(2_000);
    expect(h.ownNs()).toEqual([]);

    h.restart();
    await h.at(2_000 + 29_000);
    expect(h.ownNs()).toEqual([]);
    await h.at(2_000 + 31_000);
    expect(h.own()).toEqual([{ n: 1, type: "ack" }]);
    await h.at(200_000);
    expect(h.ownNs()).toEqual([1]);
  });
});
