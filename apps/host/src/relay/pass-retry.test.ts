import { describe, expect, test } from "bun:test";
import { RelayCloseError, type RelayProofs } from "@doriface/relay-client";
import { withPassRetry } from "./pass-retry.ts";

const RELAY = "https://relay.example";

function fakeProofs(): { proofs: RelayProofs; renew: () => void; subscribed: Promise<void>; waits: () => number } {
  const listeners = new Set<(origin: string) => void>();
  const subscribed = Promise.withResolvers<void>();
  let waits = 0;
  let usable = true;
  const proofs: RelayProofs = {
    presents: () => usable,
    proof: () => undefined,
    received: () => undefined,
    refused: () => {
      usable = false;
    },
    accepted: () => undefined,
    wantsPass: () => true,
    onWant: () => () => undefined,
    onPass: (listener) => {
      waits += 1;
      listeners.add(listener);
      subscribed.resolve();
      return () => listeners.delete(listener);
    },
  };
  return {
    proofs,
    renew: () => listeners.forEach((listener) => listener("wss://relay.example")),
    subscribed: subscribed.promise,
    waits: () => waits,
  };
}

/** The real dial (`connectRelayClient`) marks the pass it carried before its 4412 reaches the retry. */
function marking(proofs: RelayProofs, dial: () => Promise<string>): () => Promise<string> {
  return () =>
    dial().catch((error: unknown) => {
      if (error instanceof RelayCloseError && error.code === 4412) proofs.refused("wss://relay.example", "proof");
      throw error;
    });
}

function dials(...outcomes: (number | "ok")[]): { dial: () => Promise<string>; count: () => number } {
  let calls = 0;
  return {
    count: () => calls,
    dial: async () => {
      const outcome = outcomes[calls++];
      if (outcome === "ok") return `link ${calls}`;
      throw new RelayCloseError(outcome ?? 1011, "closed");
    },
  };
}

describe("a dial refused for its pass (contract v1.6, 3.6)", () => {
  test("a 4412 on a dial that carried no proof is an ordinary failure: no redial, nothing marked", async () => {
    const { proofs } = fakeProofs();
    proofs.refused("wss://relay.example", "");
    const once = dials(4412, "ok");
    const error = await withPassRetry(once.dial, proofs, RELAY, 1).catch((caught: unknown) => caught);
    expect(error instanceof RelayCloseError ? error.code : error).toBe(4412);
    expect(once.count()).toBe(1);
  });

  test("after the dial's refusal of the held pass, redials once as soon as the new pass arrives", async () => {
    const { proofs, renew, subscribed } = fakeProofs();
    const { dial, count } = dials(4412, "ok");
    const result = withPassRetry(marking(proofs, dial), proofs, RELAY, 60_000);
    await subscribed;
    renew();
    expect(await result).toBe("link 2");
    expect(count()).toBe(2);
  });

  test("redials once after the wait when no pass came, and a 4429 then is reported as the 4412", async () => {
    const { proofs, waits } = fakeProofs();
    const { dial, count } = dials(4412, 4429);
    const error = await withPassRetry(marking(proofs, dial), proofs, RELAY, 1).catch((caught: unknown) => caught);
    expect(error instanceof RelayCloseError ? error.code : error).toBe(4412);
    expect(count()).toBe(2);
    expect(waits()).toBe(1);
  });

  test("a refusal of an older pass, the newer one still presented, redials at once and never waits", async () => {
    const { proofs, waits } = fakeProofs();
    const { dial, count } = dials(4412, "ok");
    expect(await withPassRetry(dial, proofs, RELAY, 60_000)).toBe("link 2");
    expect(count()).toBe(2);
    expect(waits()).toBe(0);
    expect(proofs.presents("wss://relay.example")).toBe(true);
  });

  test("other failures of the redial, and every failure that is not a 4412, pass through untouched", async () => {
    const { proofs } = fakeProofs();
    const offline = await withPassRetry(dials(4412, 4404).dial, proofs, RELAY, 1).catch((caught: unknown) => caught);
    expect(offline instanceof RelayCloseError ? offline.code : offline).toBe(4404);
    const once = dials(4429);
    const limited = await withPassRetry(once.dial, proofs, RELAY, 1).catch((caught: unknown) => caught);
    expect(limited instanceof RelayCloseError ? limited.code : limited).toBe(4429);
    expect(once.count()).toBe(1);
  });
});
