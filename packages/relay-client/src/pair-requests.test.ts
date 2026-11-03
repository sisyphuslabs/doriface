import { describe, expect, test } from "bun:test";
import { PairSlotRequests } from "./pair-requests.ts";
import { encodePairSlotAck, MUX_HEADER_BYTES, PairSlotAckStatus } from "./wire/index.ts";

const reply = (slot: string, status: PairSlotAckStatus): Uint8Array =>
  encodePairSlotAck(slot, status).subarray(MUX_HEADER_BYTES);

describe("PAIR_SLOT requests", () => {
  test("a second request for a slot that is still waiting is refused, not merged", async () => {
    const requests = new PairSlotRequests();
    const first = requests.wait("AB3", 60_000);
    await expect(requests.wait("AB3", 60_000)).rejects.toThrow("already waiting");
    requests.settle(reply("AB3", PairSlotAckStatus.Taken));
    expect(await first).toBe("taken");
  });

  test("a request without a reply times out and frees the slot for the next one", async () => {
    const requests = new PairSlotRequests();
    await expect(requests.wait("AB3", 5)).rejects.toThrow("no PAIR_SLOT reply");
    const next = requests.wait("AB3", 60_000);
    requests.settle(reply("AB3", PairSlotAckStatus.Registered));
    expect(await next).toBe("registered");
  });

  test("a malformed status rejects the request it answers", async () => {
    const requests = new PairSlotRequests();
    const waiting = requests.wait("AB3", 60_000);
    expect(requests.settle(reply("AB3", PairSlotAckStatus.Malformed))).toBe(true);
    await expect(waiting).rejects.toThrow("malformed");
  });
});
