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
