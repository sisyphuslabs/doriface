import { describe, expect, test } from "bun:test";
import { zoomedConfig } from "../workspace/use-app-actions.ts";
import { isDefault, single, withValues } from "./config.ts";
import { rendererOptions } from "./render-options.ts";
import { serializeGhosttyConfig } from "./serialize.ts";

describe("config writes", () => {
  test("clearing a single-value text key removes the override", () => {
    const set = withValues(new Map(), "cursor-color", ["#ff0000"]);
    expect(isDefault(withValues(set, "cursor-color", []), "cursor-color")).toBe(true);
  });

  test("clearing a key whose default is not empty removes it, so export round-trips", () => {
    const set = withValues(new Map(), "scrollback-limit", ["5000"]);
    const cleared = withValues(set, "scrollback-limit", []);
    expect(isDefault(cleared, "scrollback-limit")).toBe(true);
    expect(rendererOptions(cleared).scrollbackBytes).toBe(10_000_000);
    expect(serializeGhosttyConfig(cleared)).not.toContain("scrollback-limit");
  });

  test("zoom stays within font-size bounds and reset removes the key", () => {
    const big = zoomedConfig(new Map([["font-size", ["72"]]]), 1);
    expect(single(big, "font-size")).toBe("72");
    const small = zoomedConfig(new Map([["font-size", ["4"]]]), -1);
    expect(single(small, "font-size")).toBe("4");
    expect(isDefault(zoomedConfig(big, null), "font-size")).toBe(true);
    expect(single(zoomedConfig(new Map(), 1), "font-size")).toBe("14");
  });
});
