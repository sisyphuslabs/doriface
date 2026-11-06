import { describe, expect, test } from "bun:test";
import { requireFeature, requireWithin } from "./gate.ts";
import { OPEN_POLICY, parsePolicy, type PlanLimit, type PlanPolicy } from "./policy.ts";

const ALL_LIMITS = ["machines", "devices", "sessions"] as const;

/** What the gate answered: the words a person reads, or that it let the request through. */
const answer = (policy: PlanPolicy, limit: PlanLimit, current: number): string => {
  const decision = requireWithin(policy, limit, current);
  return "message" in decision ? decision.message : "admitted";
};

describe("the open default", () => {
  test("a build with no policy admits every count, however many are already in use", () => {
    for (const limit of ALL_LIMITS) {
      expect(requireWithin(OPEN_POLICY, limit, 0)).toEqual({ allowed: true });
      expect(requireWithin(OPEN_POLICY, limit, 1_000_000)).toEqual({ allowed: true });
    }
  });

  test("a build with no policy carries every feature", () => {
    expect(requireFeature(OPEN_POLICY, "pairing")).toEqual({ allowed: true });
  });

  test("a plan that withholds a feature leaves every limit open", () => {
    const policy = parsePolicy('{"plan":"free","withoutFeatures":["pairing"]}');
    expect(answer(policy, "devices", 99)).toBe("admitted");
    expect(answer(policy, "machines", 99)).toBe("admitted");
    expect(answer(policy, "sessions", 99)).toBe("admitted");
  });
});

describe("a policy that names a limit", () => {
  const policy = parsePolicy('{"plan":"free","limits":{"devices":3}}');

  test("admits one more while there is room, and refuses the request that fills the plan", () => {
    expect(answer(policy, "devices", 2)).toBe("admitted");
    expect(requireWithin(policy, "devices", 3)).toEqual({
      allowed: false,
      reason: "limit_reached",
      limit: "devices",
      max: 3,
      message: "This computer has 3 paired devices, and the free plan allows 3. Remove a device to make room.",
    });
  });

  test("says what is already in use in the words of each limit", () => {
    expect(answer(parsePolicy('{"plan":"free","limits":{"machines":12}}'), "machines", 12)).toBe(
      "This mesh has 12 machines, and the free plan allows 12. Remove a machine from the mesh to make room.",
    );
    expect(answer(parsePolicy('{"plan":"free","limits":{"sessions":1}}'), "sessions", 1)).toBe(
      "1 session is open, and the free plan allows 1. Close a session to make room.",
    );
    expect(answer(parsePolicy('{"plan":"free","limits":{"devices":1}}'), "devices", 1)).toBe(
      "This computer has 1 paired device, and the free plan allows 1. Remove a device to make room.",
    );
  });

  test("points at more room only when the policy has an address for it", () => {
    const withAddress = parsePolicy('{"plan":"free","limits":{"devices":1},"upgradeUrl":"https://example.com/plans"}');
    expect(answer(withAddress, "devices", 1)).toBe(
      "This computer has 1 paired device, and the free plan allows 1. Remove a device to make room. More room: https://example.com/plans",
    );
  });

  test("narrows nothing else: the limits it does not name stay open", () => {
    expect(answer(policy, "machines", 1_000)).toBe("admitted");
    expect(answer(policy, "sessions", 1_000)).toBe("admitted");
  });
});

describe("a policy that withholds a feature", () => {
  test("refuses with the plan and the feature named, and points at more room when it can", () => {
    expect(requireFeature(parsePolicy('{"plan":"free","withoutFeatures":["pairing"]}'), "pairing")).toEqual({
      allowed: false,
      reason: "feature_missing",
      feature: "pairing",
      message: "The free plan does not include pairing a device.",
    });
    expect(
      requireFeature(
        parsePolicy('{"plan":"free","withoutFeatures":["pairing"],"upgradeUrl":"https://example.com/plans"}'),
        "pairing",
      ),
    ).toMatchObject({ message: expect.stringContaining("More room: https://example.com/plans") });
  });
});
