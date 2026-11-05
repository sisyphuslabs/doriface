import { describe, expect, test } from "bun:test";
import { compareVersions, meetsHcFloor, MIN_HC_VERSION, parseHcVersionLine } from "./hc-version.ts";

describe("parseHcVersionLine (#406)", () => {
  test("V1: a release, a prerelease and build metadata are versions", () => {
    expect(parseHcVersionLine("hc 0.1.17\n")).toBe("0.1.17");
    expect(parseHcVersionLine("hc 0.1.17-rc.1")).toBe("0.1.17-rc.1");
    expect(parseHcVersionLine("hc 0.1.17+build.5")).toBe("0.1.17+build.5");
  });

  test("V2: leading zeros, empty identifiers and other text are not", () => {
    for (const line of [
      "hc 00.1.17",
      "hc 0.01.17",
      "hc 0.1.17-01",
      "hc 0.1.17-",
      "hc 0.1.17-rc..1",
      "hc 0.1.17+",
      "hc 0.1",
      "hc garbage",
      "herdr 0.1.17",
      "hc 1234567890.0.0",
    ]) {
      expect(parseHcVersionLine(line)).toBeUndefined();
    }
  });
});

describe("compareVersions and the 0.1.17 floor (#406)", () => {
  test("V3: the floor is 0.1.17", () => {
    expect(MIN_HC_VERSION).toBe("0.1.17");
  });

  test("V4: 0.1.16 and a prerelease of 0.1.17 are below it", () => {
    expect(meetsHcFloor("0.1.16")).toBe(false);
    expect(meetsHcFloor("0.1.17-rc.1")).toBe(false);
    expect(meetsHcFloor("0.0.99")).toBe(false);
  });

  test("V5: 0.1.17, its build metadata and anything newer meet it", () => {
    for (const version of ["0.1.17", "0.1.17+b", "0.1.18", "0.2.0", "1.0.0"]) expect(meetsHcFloor(version)).toBe(true);
  });

  test("V6: core numbers compare numerically, not as text", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  });

  test("V7: prerelease precedence follows Semantic Versioning 2.0.0", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(compareVersions(ordered[index - 1] ?? "", ordered[index] ?? "")).toBeLessThan(0);
    }
  });

  test("V8: build metadata does not change precedence", () => {
    expect(compareVersions("0.1.17+a", "0.1.17+b")).toBe(0);
  });
});
