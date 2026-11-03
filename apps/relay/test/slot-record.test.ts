import { describe, expect, test } from "bun:test";
import { claimSlot, liveRecord, PAIR_SLOT_TTL_MS, type SlotRecord } from "../src/slot-record.ts";

const record = (hostId: string): SlotRecord => ({ hostId, noiseStaticPub: "n", signPub: "s" });

describe("pairing slot rules", () => {
  test("a free slot is claimed for ten minutes", () => {
    expect(claimSlot(undefined, record("a"), 1_000)).toEqual({
      record: record("a"),
      expiresAt: 1_000 + PAIR_SLOT_TTL_MS,
    });
  });

  test("a live slot held by another host is refused, and by the same host refreshed", () => {
    const held = claimSlot(undefined, record("a"), 0);
    expect(claimSlot(held, record("b"), PAIR_SLOT_TTL_MS - 1)).toBeUndefined();
    expect(claimSlot(held, record("a"), 5)?.expiresAt).toBe(5 + PAIR_SLOT_TTL_MS);
  });

  test("an expired slot is gone and free to claim", () => {
    const held = claimSlot(undefined, record("a"), 0);
    expect(liveRecord(held, PAIR_SLOT_TTL_MS)).toBeUndefined();
    expect(claimSlot(held, record("b"), PAIR_SLOT_TTL_MS)?.record.hostId).toBe("b");
  });
});
