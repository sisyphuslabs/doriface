import { describe, expect, test } from "bun:test";
import { memoryStore } from "../storage/idb.ts";
import { KEYMAP_VERSION, KeymapStore } from "./keymap-store.ts";
import {
  checkBinding,
  parseKeybinds,
  resetAction,
  resolveKeymap,
  serializeKeybinds,
  triggersFor,
  withBinding,
  withoutTrigger,
} from "./keymap.ts";
import { normalizeTrigger, triggerFromEvent } from "./trigger.ts";

describe("resolveKeymap", () => {
  test("defaults differ per platform and overrides win", () => {
    expect(resolveKeymap("mac", new Map()).get("super+t")).toBe("tab.new");
    expect(resolveKeymap("other", new Map()).get("ctrl+shift+t")).toBe("tab.new");
    const keymap = resolveKeymap(
      "mac",
      new Map([
        ["super+t", "tab.close"],
        ["super+w", null],
      ]),
    );
    expect(keymap.get("super+t")).toBe("tab.close");
    expect(keymap.has("super+w")).toBe(false);
  });

  test("a changed default never overwrites an override", () => {
    const overrides = withBinding("mac", new Map(), "super+shift+n", "tab.new");
    const shipped = resolveKeymap("mac", new Map());
    const changed = new Map(shipped);
    changed.set("super+shift+n", "pane.split");
    const resolved = new Map(changed);
    for (const [trigger, action] of overrides) if (action !== null) resolved.set(trigger, action);
    expect(resolved.get("super+shift+n")).toBe("tab.new");
    expect(resolveKeymap("mac", overrides).get("super+shift+n")).toBe("tab.new");
  });

  test("removals are stored explicitly and reset forgets them", () => {
    const removed = withoutTrigger("mac", new Map(), "super+t");
    expect(removed.get("super+t")).toBeNull();
    expect(triggersFor(resolveKeymap("mac", removed), "tab.new")).toEqual([]);
    expect(resetAction("mac", removed, "tab.new").size).toBe(0);
    expect(withoutTrigger("mac", new Map([["super+shift+n", "tab.new"]]), "super+shift+n").size).toBe(0);
  });
});

describe("triggers", () => {
  test.each([
    ["cmd+shift+T", "shift+super+t"],
    ["ctrl++", "ctrl+shift+="],
    ["Ctrl+Shift+PageDown", "ctrl+shift+page_down"],
    ["super", null],
    ["ctrl+nope", null],
  ])("%p -> %p", (text, expected) => expect(normalizeTrigger(text)).toBe(expected));

  test("herdr-app's dash syntax", () => {
    expect(normalizeTrigger("cmd-alt-shift-left", true)).toBe("alt+shift+super+left");
    expect(normalizeTrigger("ctrl--", true)).toBe("ctrl+-");
  });

  test("key events use layout-independent codes", () => {
    const event = { code: "KeyT", ctrlKey: false, altKey: false, shiftKey: true, metaKey: true };
    expect(triggerFromEvent(event)).toBe("shift+super+t");
    expect(triggerFromEvent({ ...event, code: "ShiftLeft" })).toBeNull();
  });
});

describe("keybind import and export", () => {
  test("parses Ghostty keybind lines, including unbind, text and unknown actions", () => {
    const parsed = parseKeybinds(
      [
        "font-size = 12",
        "keybind = super+shift+n=new_tab",
        "keybind = super+t=unbind",
        "keybind = alt+b=text:\\x1bb",
        "keybind = super+i=inspector:toggle",
        "keybind = super=new_tab",
      ].join("\n"),
    );
    expect(parsed.lines.map((line) => line.status)).toEqual(["applies", "applies", "applies", "unknown", "invalid"]);
    expect(parsed.overrides.get("shift+super+n")).toBe("tab.new");
    expect(parsed.overrides.get("super+t")).toBeNull();
    expect(parsed.overrides.get("alt+b")).toBe("send:\u001bb");
  });

  test("export then import round-trips", () => {
    const overrides = new Map<string, string | null>([
      ["shift+super+n", "tab.new"],
      ["super+t", null],
      ["alt+b", "send:\u001bb"],
    ]);
    expect(new Map(parseKeybinds(serializeKeybinds(overrides)).overrides)).toEqual(overrides);
  });
});

describe("KeymapStore", () => {
  test("refuses an invalid write and keeps what it had", async () => {
    const store = new KeymapStore(memoryStore());
    await store.loaded;
    await expect(store.update(new Map([["super", "tab.new"]]))).rejects.toThrow("not a key combination");
    await expect(store.update(new Map([["super+t", "nope"]]))).rejects.toThrow("not an action");
    expect(store.overrides.size).toBe(0);
    expect(checkBinding("super+t", null).ok).toBe(true);
  });

  test("backs up an older version before migrating it", async () => {
    const storage = memoryStore();
    await storage.put("keymap", {
      version: 0,
      bindings: [
        ["super+shift+n", "tab.new"],
        ["bad", "tab.new"],
      ],
    });
    const store = new KeymapStore(storage);
    await store.loaded;
    expect(store.overrides.get("shift+super+n")).toBe("tab.new");
    expect(store.overrides.size).toBe(1);
    expect(await storage.get("keymap.backup.v0")).toEqual({
      version: 0,
      bindings: [
        ["super+shift+n", "tab.new"],
        ["bad", "tab.new"],
      ],
    });
    expect(await storage.get("keymap")).toEqual({ version: KEYMAP_VERSION, bindings: [["shift+super+n", "tab.new"]] });
  });
});
