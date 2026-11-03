import { describe, expect, test } from "bun:test";
import { defaultKeymap } from "./defaults.ts";
import { triggersFor } from "./keymap.ts";
import { GHOSTTY_DEFAULTS } from "./ghostty-defaults.ts";
import { HERDR_APP_MAC, HERDR_APP_OTHER } from "./herdr-app-defaults.ts";

/** Actions doriface adds on top of herdr-app and Ghostty; their triggers must be free in both. */
const DORIFACE_ONLY = ["layout.focus:sidebar"];

describe("doriface-only bindings", () => {
  test.each([
    ["mac", HERDR_APP_MAC],
    ["other", HERDR_APP_OTHER],
  ] as const)("on %s they take no trigger that herdr-app or Ghostty binds by default", (platform, herdr) => {
    const taken = new Set([...GHOSTTY_DEFAULTS, ...herdr]);
    const triggers = DORIFACE_ONLY.flatMap((action) => triggersFor(defaultKeymap(platform), action));
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.filter((trigger) => taken.has(trigger))).toEqual([]);
  });
});

describe("the vendored Ghostty table", () => {
  test("includes the bindings whose modifier Ghostty computes per platform (ctrlOrSuper and its mods variables)", () => {
    const computed = ["shift+super+p", "ctrl+shift+p", "super+,", "ctrl+,", "super+enter", "ctrl+enter"];
    const variables = ["super+c", "ctrl+shift+c", "super+v", "ctrl+shift+v", "super+=", "ctrl+="];
    const listed = new Set(GHOSTTY_DEFAULTS);
    expect([...computed, ...variables].filter((trigger) => !listed.has(trigger))).toEqual([]);
  });
});
