import { describe, expect, test } from "bun:test";
import { evictionVictim } from "../src/admission.ts";
import { PAIR_BUDGET, PAIR_BUDGET_WINDOW_MS, spendAttempt } from "../src/pair-budget.ts";

interface Pending {
  readonly id: string;
  readonly ip: string;
  readonly openedAt: number;
}

const pending = (id: string, ip: string, openedAt: number): Pending => ({ id, ip, openedAt });

describe("pending eviction", () => {
  test("evicts the oldest pending session of the source holding the most", () => {
    const queue = [pending("a1", "a", 1), pending("b1", "b", 2), pending("b2", "b", 3), pending("a2", "a", 4)];
    expect(evictionVictim([...queue, pending("b3", "b", 0)], (entry) => entry)?.id).toBe("b3");
    expect(evictionVictim(queue.slice(1), (entry) => entry)?.id).toBe("b1");
    expect(evictionVictim([], (entry: Pending) => entry)).toBeUndefined();
  });
});

describe("pairing budget", () => {
  test("allows 10 attempts per sliding 10-minute window", () => {
    const spent = Array.from({ length: PAIR_BUDGET }, (_, index) => index * 1_000);
    expect(spendAttempt(spent.slice(0, -1), 9_000).allowed).toBe(true);
    expect(spendAttempt(spent, 10_000)).toEqual({ allowed: false, times: spent });
    const later = spendAttempt(spent, PAIR_BUDGET_WINDOW_MS + 1);
    expect(later.allowed).toBe(true);
    expect(later.times).toEqual([...spent.slice(1), PAIR_BUDGET_WINDOW_MS + 1]);
  });
});
