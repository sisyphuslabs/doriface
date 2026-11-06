import { describe, expect, test } from "bun:test";
import { OPEN_POLICY, parsePolicy, PolicyError, policyFromEnv } from "./policy.ts";

const UNLIMITED = Number.POSITIVE_INFINITY;

/** Parses `raw` and reports what reading it said: the policy's edge, or the words it was refused with. */
const read = (raw: string | undefined): string => {
  try {
    const policy = parsePolicy(raw);
    return `parsed as ${policy.plan}`;
  } catch (error) {
    return error instanceof PolicyError ? error.message : `not a PolicyError: ${String(error)}`;
  }
};

describe("a build handed no policy", () => {
  test("is open for every limit and carries every feature", () => {
    expect(parsePolicy(undefined)).toEqual(OPEN_POLICY);
    expect(parsePolicy("")).toEqual(OPEN_POLICY);
    expect(parsePolicy("   ")).toEqual(OPEN_POLICY);
    expect(policyFromEnv({})).toEqual(OPEN_POLICY);
    expect(OPEN_POLICY.limits).toEqual({ machines: UNLIMITED, devices: UNLIMITED, sessions: UNLIMITED });
    expect(OPEN_POLICY.withoutFeatures).toEqual([]);
  });

  test("takes the document from the environment key it names", () => {
    const env = { DORIFACE_POLICY: '{"plan":"free","limits":{"devices":2}}' };
    expect(policyFromEnv(env).limits.devices).toBe(2);
    expect(policyFromEnv({}, "DORIFACE_POLICY").limits.devices).toBe(UNLIMITED);
  });
});

describe("a document that narrows one thing", () => {
  test("narrows exactly the limit it names and leaves the others unlimited", () => {
    const policy = parsePolicy('{"plan":"free","limits":{"devices":3}}');
    expect(policy.plan).toBe("free");
    expect(policy.limits).toEqual({ machines: UNLIMITED, devices: 3, sessions: UNLIMITED });
    expect(policy.withoutFeatures).toEqual([]);
  });

  test("names its plan so a refusal can name it, and falls back to a plain word when it does not", () => {
    expect(parsePolicy('{"limits":{"devices":1}}').plan).toBe("custom");
  });

  test("carries an address for more room only when it has one", () => {
    expect(parsePolicy('{"upgradeUrl":"https://example.com/plans"}').upgradeUrl).toBe("https://example.com/plans");
    expect(parsePolicy('{"plan":"free"}').upgradeUrl).toBeUndefined();
  });
});

describe("a document that cannot be read as one", () => {
  test.each([
    ["not json", "is not JSON"],
    ["[]", "must be a JSON object"],
    ['{"limits":{"device":3}}', '"device", which is not a limit'],
    ['{"limits":{"devices":0}}', "at least 1"],
    ['{"limits":{"devices":1.5}}', "whole count"],
    ['{"withoutFeatures":["pairng"]}', '"pairng", which is not a feature'],
    ['{"plan":""}', "must be a name"],
    ['{"upgradeUrl":"ftp://example.com"}', "http(s) address"],
    ['{"limit":{"devices":3}}', '"limit", which is not a setting'],
  ])("%s is refused rather than read as open", (raw, why) => {
    expect(read(raw)).toContain(why);
  });
});
