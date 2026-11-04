import { describe, expect, test } from "bun:test";
import { actionFor } from "./actions.ts";
import { defaultKeymap } from "./defaults.ts";
import { TEXT_FIELD_KEEPS } from "./text-field-keys.ts";
import { normalizeTrigger, type Platform } from "./trigger.ts";

const ARROWS = ["left", "right", "up", "down"];

const chords = (mods: readonly string[], keys: readonly string[]): string[] =>
  mods.flatMap((mod) => keys.flatMap((key) => normalizeTrigger(mod === "" ? key : `${mod}+${key}`) ?? []));

const TEXT_EDITING: Readonly<Record<Platform, ReadonlySet<string>>> = {
  mac: new Set([
    ...chords(["", "shift", "alt", "alt+shift", "super", "super+shift"], ARROWS),
    ...chords(["shift"], ["home", "end"]),
    ...chords(["alt", "super"], ["backspace"]),
  ]),
  other: new Set([
    ...chords(["", "shift", "ctrl", "ctrl+shift"], [...ARROWS, "home", "end"]),
    ...chords(["ctrl"], ["backspace"]),
  ]),
};

const appActionsOnTextChords = (platform: Platform): string[] =>
  [...defaultKeymap(platform)]
    .filter(([trigger, id]) => actionFor(id)?.scope === "app" && TEXT_EDITING[platform].has(trigger))
    .map(([, id]) => id);

describe("app chords that edit text", () => {
  test.each(["mac", "other"] as const)(
    "on %s every app action bound to a text-editing chord leaves it to a text field",
    (platform) => {
      expect(appActionsOnTextChords(platform).filter((id) => !TEXT_FIELD_KEEPS.has(id))).toEqual([]);
    },
  );

  test("on a Mac the tab moves sit on ⌘⇧←/→, which select to the line's start or end", () => {
    expect(appActionsOnTextChords("mac").sort()).toEqual(["tab.move:left", "tab.move:right"]);
  });
});
