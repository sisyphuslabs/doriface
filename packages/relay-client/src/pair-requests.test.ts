import { describe, expect, test } from "bun:test";
import { PairSlotRequests } from "./pair-requests.ts";
import { encodePairSlotReply, MUX_HEADER_BYTES, PairSlotStatus } from "./wire/index.ts";

const reply = (slot: string, status: PairSlotStatus): Uint8Array =>
  encodePairSlotReply(slot, status).subarray(MUX_HEADER_BYTES);

describe("PAIR_SLOT requests", () => {
  test("a second request for a slot that is still waiting is refused, not merged", async () => {
    const requests = new PairSlotRequests();
    const first = requests.wait("AB3", 60_000);
    await expect(requests.wait("AB3", 60_000)).rejects.toThrow("already waiting");
    requests.settle(reply("AB3", PairSlotStatus.Taken));
    expect(await first).toBe("taken");
  });

  test("a request without a reply times out and frees the slot for the next one", async () => {
    const requests = new PairSlotRequests();
    await expect(requests.wait("AB3", 5)).rejects.toThrow("no PAIR_SLOT reply");
    const next = requests.wait("AB3", 60_000);
    requests.settle(reply("AB3", PairSlotStatus.Registered));
    expect(await next).toBe("registered");
  });
});
