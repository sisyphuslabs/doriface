import { describe, expect, test } from "bun:test";
import { activeThemeId, DEFAULT_APPEARANCE, parseAppearance } from "./stored.ts";

describe("parseAppearance", () => {
  test("a stored mode and picks come back as stored", () => {
    const stored = { mode: "light", dark: "dracula", light: "solarized-light", custom: [] };
    expect(parseAppearance(stored)).toEqual({ mode: "light", dark: "dracula", light: "solarized-light", custom: [] });
  });

  test.each([
    [{ theme: "system" }, { mode: "system", dark: "night", light: "day" }],
    [{ theme: "graphite" }, { mode: "dark", dark: "graphite", light: "day" }],
    [{ theme: "paper" }, { mode: "light", dark: "night", light: "paper" }],
    [{ theme: "gone" }, { mode: "system", dark: "night", light: "day" }],
  ] as const)("the one-theme form %j becomes a mode and a pick", (stored, expected) => {
    expect(parseAppearance({ ...stored, custom: [] })).toEqual({ ...expected, custom: [] });
  });

  test("a pick of the wrong kind or an unknown id falls back to the default for that kind", () => {
    expect(parseAppearance({ mode: "dark", dark: "day", light: "nope", custom: [] })).toEqual({
      ...DEFAULT_APPEARANCE,
      mode: "dark",
    });
  });

  test("anything that is not an object is the default", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("night")).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("activeThemeId", () => {
  const appearance = { ...DEFAULT_APPEARANCE, dark: "nord", light: "tomorrow" };
  test.each([
    ["system", true, "nord"],
    ["system", false, "tomorrow"],
    ["dark", false, "nord"],
    ["light", true, "tomorrow"],
  ] as const)("%s with the system dark=%p shows %s", (mode, systemDark, id) => {
    expect(activeThemeId({ ...appearance, mode }, systemDark)).toBe(id);
  });
});
