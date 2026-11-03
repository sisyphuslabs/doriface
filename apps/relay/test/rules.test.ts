import { describe, expect, test } from "bun:test";
import { evictionVictim } from "../src/admission.ts";
import { PAIR_BUDGET, PAIR_BUDGET_WINDOW_MS, spendAttempt } from "../src/pair-budget.ts";
import { sourceKey } from "../src/source-ip.ts";

describe("source keys", () => {
  test("IPv6 addresses share a key per /64, however they are written", () => {
    const key = sourceKey("2001:db8:1:2::1");
    expect(key).toBe("2001:db8:1:2::/64");
    for (const same of ["2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:0DB8:0001:0002::abcd", "2001:db8:1:2:0:0:1.2.3.4"]) {
      expect(sourceKey(same)).toBe(key);
    }
    expect(sourceKey("2001:db8:1:3::1")).not.toBe(key);
    expect(sourceKey("::1")).toBe("0:0:0:0::/64");
    expect(sourceKey("fe80::1%en0")).toBe("fe80:0:0:0::/64");
  });

  test("IPv4 stays per address, including IPv4-mapped IPv6", () => {
    expect(sourceKey("198.51.100.7")).toBe("198.51.100.7");
    expect(sourceKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(sourceKey("not an address")).toBe("not an address");
  });

  test("a dotted IPv6 tail must be four decimal octets", () => {
    for (const malformed of ["::1.2.3.", "::0x1.0x2.0x3.0x4", "::1.2.3.4.5", "::1.2.3.256", "::1e1.2.3.4"]) {
      expect(sourceKey(malformed)).toBe(malformed);
    }
    expect(sourceKey("::1.2.3.4")).toBe("0:0:0:0::/64");
  });
});

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
