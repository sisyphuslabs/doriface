import { describe, expect, test } from "bun:test";
import { CLAIM_MS } from "./claims.ts";
import { hostB, restored } from "./testing/claim-host.ts";
import { peer } from "./testing/mesh-peers.ts";

const [a, b] = [peer("a"), peer("b")];
const MAX = Number.MAX_SAFE_INTEGER;

// #151: status reads the claim that holds this host's own records back now, not the highest a hello ever showed.
describe("the counter status reports is the standing claim (section 10.1, #151)", () => {
  test("a claim that expires stops counting, and a claim ignored in its cooldown never counts", async () => {
    const { records } = restored(0);
    const h = hostB(records, 61);
    h.connect(a).hello({ [b.signPub]: MAX });
    await h.at(1_000);
    expect(h.gossip.peerCounter).toBe(MAX);
    await h.at(CLAIM_MS + 1_001);
    expect(h.cooldowns()).toBe(1);
    expect(h.gossip.peerCounter).toBe(0);
    h.connect(a).hello({ [b.signPub]: MAX });
    await h.at(CLAIM_MS + 2_000);
    expect(h.gossip.peerCounter).toBe(0);
  });

  test("a claim the claimed records resolve stops counting", async () => {
    const { records, chain, heads } = restored(2);
    const h = hostB(records, 62);
    const session = h.connect(a, heads);
    session.hello({ [b.signPub]: 2 });
    await h.at(1_000);
    expect(h.gossip.peerCounter).toBe(2);
    session.send(...chain);
    session.done();
    await h.at(2_000);
    expect(h.ownNs()).toEqual([1, 2]);
    expect(h.gossip.peerCounter).toBe(0);
  });
});
