import { describe, expect, test } from "bun:test";
import { DIAL_LIMITS, DialPolicy } from "./dial-policy.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";

describe("a token given back (section 8.2, L-E3)", () => {
  test("is the released dial's own charge, so the window frees when the dials that did run expire", async () => {
    const clock = new FakeClock();
    const limits = { ...DIAL_LIMITS, budget: 2 };
    const policy = new DialPolicy({ clock, random: seededRandom(11), onDue: () => undefined, limits });
    const unneeded = await policy.acquire("a", "push");
    await clock.advance(10_000);
    await policy.acquire("b", "push");
    await clock.advance(10_000);
    policy.release(unneeded.ok ? unneeded.chargedAt : undefined);
    await policy.acquire("c", "push");
    const grantedAt = policy.acquire("d", "push").then(() => clock.now());
    await clock.advance(DIAL_LIMITS.windowMs);
    expect(await grantedAt).toBe(10_000 + DIAL_LIMITS.windowMs);
  });
});
