import { describe, expect, test } from "bun:test";
import { memoryLinkPair } from "@doriface/crypto/testing";
import { DialPolicy } from "./dial-policy.ts";
import { MemberDialer } from "./member-dialer.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { peer } from "./testing/mesh-peers.ts";

describe("a member that answered a dial (L-E2)", () => {
  test("is not gated as offline when this host fails to attach the session; the session closes 1011", async () => {
    const member = peer("a");
    const policy = new DialPolicy({ clock: new FakeClock(), random: seededRandom(7), onDue: () => undefined });
    const [near] = memoryLinkPair(true);
    const dialer = new MemberDialer({
      policy,
      dial: () => Promise.resolve(near),
      flushOpen: () => false,
      attach: () => {
        throw new Error("the session could not start");
      },
      log: () => undefined,
    });
    expect(await dialer.sync(member, "push")).toBe(false);
    expect(policy.gate(member.signPub)).toBeUndefined();
    expect(near.closeCode).toBe(1011);
  });
});
