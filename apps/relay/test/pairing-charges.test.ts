import { describe, expect, test } from "bun:test";
import { PairingCharges } from "../src/pairing.ts";

describe("pairing charges", () => {
  test("a charge that throws is reported as failed, never left to reject", async () => {
    const charges = new PairingCharges(() => Promise.reject(new Error("PairSlot unavailable")));
    const outcome = charges.charge(7, "AB3");
    expect(charges.inFlight(7)).toBe(outcome);
    expect(await outcome).toBe("failed");
    expect(charges.inFlight(7)).toBeUndefined();
  });

  test("a charge reports whether the slot's budget took it", async () => {
    const budget = [true, false];
    const charges = new PairingCharges(async () => budget.shift() ?? false);
    expect(await charges.charge(1, "AB3")).toBe("charged");
    expect(await charges.charge(2, "AB3")).toBe("spent");
  });
});
