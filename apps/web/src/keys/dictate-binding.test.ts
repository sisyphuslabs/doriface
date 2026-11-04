import { expect, test } from "bun:test";
import { ACTION_BY_ID } from "./actions.ts";
import { defaultKeymap } from "./defaults.ts";
import { checkBinding, resolveKeymap, triggersFor } from "./keymap.ts";

test("Dictate is an app action the keymap can bind, with no default chord on any platform (#194 Q3)", () => {
  expect(ACTION_BY_ID.get("voice.dictate")).toEqual({ id: "voice.dictate", scope: "app", label: "Dictate" });
  for (const platform of ["mac", "other"] as const) {
    expect(triggersFor(defaultKeymap(platform), "voice.dictate")).toEqual([]);
  }
  const bound = checkBinding("ctrl+alt+d", "voice.dictate");
  expect(bound.ok).toBe(true);
  if (!bound.ok) return;
  const keymap = resolveKeymap("other", new Map([[bound.trigger, "voice.dictate"]]));
  expect(triggersFor(keymap, "voice.dictate")).toEqual([bound.trigger]);
});
