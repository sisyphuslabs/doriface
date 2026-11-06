import { describe, expect, test } from "bun:test";
import { defaultKeymap } from "./defaults.ts";
import { triggersFor } from "./keymap.ts";

const spaces = (platform: "mac" | "other"): string[][] =>
  Array.from({ length: 9 }, (_, index) => triggersFor(defaultKeymap(platform), `space.select:${index + 1}`));

describe("the space keys, as herdr-app binds them", () => {
  test("on a Mac Ctrl+1-9 select a space, Cmd+1-9 stay its tabs, and Cmd+Alt+[ / ] cycle the spaces", () => {
    const keymap = defaultKeymap("mac");
    expect(spaces("mac")).toEqual(Array.from({ length: 9 }, (_, index) => [`ctrl+${index + 1}`]));
    expect(triggersFor(keymap, "tab.select:1")).toEqual(["super+1"]);
    expect(triggersFor(keymap, "tab.select:9")).toEqual(["super+9"]);
    expect(triggersFor(keymap, "space.prev")).toEqual(["alt+super+["]);
    expect(triggersFor(keymap, "space.next")).toEqual(["alt+super+]"]);
  });

  test("on Linux and Windows Ctrl+1-9 select a space, Alt+1-9 are its tabs, and Ctrl+Alt+[ / ] cycle the spaces", () => {
    const keymap = defaultKeymap("other");
    expect(spaces("other")).toEqual(Array.from({ length: 9 }, (_, index) => [`ctrl+${index + 1}`]));
    expect(triggersFor(keymap, "tab.select:1")).toEqual(["alt+1"]);
    expect(triggersFor(keymap, "tab.select:9")).toEqual(["alt+9"]);
    expect(triggersFor(keymap, "space.prev")).toEqual(["ctrl+alt+["]);
    expect(triggersFor(keymap, "space.next")).toEqual(["ctrl+alt+]"]);
  });

  test("no platform binds a number chord to both a tab and a space", () => {
    for (const platform of ["mac", "other"] as const) {
      const keymap = defaultKeymap(platform);
      for (let place = 1; place <= 9; place += 1) {
        const tab = triggersFor(keymap, `tab.select:${place}`);
        const space = triggersFor(keymap, `space.select:${place}`);
        expect(tab.filter((trigger) => space.includes(trigger))).toEqual([]);
      }
    }
  });
});
