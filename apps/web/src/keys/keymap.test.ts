import { describe, expect, test } from "bun:test";
import { memoryStore } from "../storage/idb.ts";
import { KEYMAP_VERSION, KeymapStore } from "./keymap-store.ts";
import {
  checkBinding,
  importKeybinds,
  isChanged,
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
    const overrides = withBinding("mac", new Map(), "super+t", "tab.close");
    const shipped = resolveKeymap("mac", new Map());
    const changedDefaults = new Map([...shipped, ["super+t", "pane.split"], ["super+shift+y", "agent.next"]]);
    const resolved = resolveKeymap("mac", overrides, changedDefaults);
    expect(resolved.get("super+t")).toBe("tab.close");
    expect(resolved.get("shift+super+y")).toBeUndefined();
    expect(resolved.get("super+shift+y")).toBe("agent.next");
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
    ["ctrl+++", null],
    ["++", "shift+="],
  ])("%p -> %p", (text, expected) => expect(normalizeTrigger(text)).toBe(expected));

  test("herdr-app's dash syntax", () => {
    expect(normalizeTrigger("cmd-alt-shift-left", true)).toBe("alt+shift+super+left");
    expect(normalizeTrigger("ctrl--", true)).toBe("ctrl+-");
    expect(normalizeTrigger("ctrl---", true)).toBeNull();
  });

  test("key events use layout-independent codes", () => {
    const event = { code: "KeyT", ctrlKey: false, altKey: false, shiftKey: true, metaKey: true };
    expect(triggerFromEvent(event)).toBe("shift+super+t");
    expect(triggerFromEvent({ ...event, code: "ShiftLeft" })).toBeNull();
    expect(triggerFromEvent({ ...event, code: "F12" })).toBe("shift+super+f12");
    expect(triggerFromEvent({ ...event, code: "F13" })).toBeNull();
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

  test("keybind = clear drops every default before the file's own lines", () => {
    const parsed = parseKeybinds("keybind = clear\nkeybind = super+shift+n=new_tab");
    expect(parsed.clear).toBe(true);
    const keymap = resolveKeymap("mac", importKeybinds("mac", new Map(), parsed));
    expect([...keymap]).toEqual([["shift+super+n", "tab.new"]]);
  });

  test("text: decodes Zig string escapes and rejects unknown ones", () => {
    const parsed = parseKeybinds(
      [
        "keybind = shift+enter=text:\\x1b\\r",
        "keybind = super+j=text:\\n",
        "keybind = super+k=text:a\\tb\\\\c\\u{1F600}",
        "keybind = super+l=text:\\q",
      ].join("\n"),
    );
    expect(parsed.lines.map((line) => line.status)).toEqual(["applies", "applies", "applies", "invalid"]);
    expect(parsed.overrides.get("shift+enter")).toBe("send:\u001b\r");
    expect(parsed.overrides.get("super+j")).toBe("send:\n");
    expect(parsed.overrides.get("super+k")).toBe("send:a\tb\\c\u{1F600}");
    expect(parsed.overrides.has("super+l")).toBe(false);
  });

  test("a parameter doriface does not have is unknown, not another action", () => {
    expect(parseKeybinds("keybind = super+x=goto_tab:12").lines[0]?.status).toBe("unknown");
    expect(parseKeybinds("keybind = super+x=new_split:down").lines[0]?.status).toBe("unknown");
  });

  test("the = key and actions without a Ghostty name export so they import back", () => {
    const text = serializeKeybinds(
      new Map([
        ["ctrl+=", "app.zoom_in"],
        ["super+j", "agent.next"],
      ]),
    );
    expect(text).toContain("keybind = ctrl+equal=increase_font_size:1");
    expect(text).toContain("# keybind = super+j=agent.next (no Ghostty equivalent)");
    expect([...parseKeybinds(text).overrides]).toEqual([["ctrl+=", "app.zoom_in"]]);
  });

  test("reset and changed cover a default moved to another action", () => {
    const moved = withBinding("mac", new Map(), "super+t", "tab.close");
    expect(isChanged("mac", moved, "tab.new")).toBe(true);
    expect(resolveKeymap("mac", resetAction("mac", moved, "tab.new")).get("super+t")).toBe("tab.new");
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
    const kept = new Map([["shift+super+n", "tab.new"]]);
    await store.update(() => kept);
    await expect(store.update(() => new Map([["super", "tab.new"]]))).rejects.toThrow("not a key combination");
    await expect(store.update(() => new Map([["super+t", "nope"]]))).rejects.toThrow("not an action");
    expect(store.overrides).toEqual(kept);
    expect(checkBinding("super+t", null).ok).toBe(true);
  });

  test("a binding made before the stored keymap loads applies on top of it", async () => {
    const gate = Promise.withResolvers<void>();
    const stored = {
      version: KEYMAP_VERSION,
      bindings: [
        ["shift+super+n", "tab.new"],
        ["super+t", null],
      ],
    };
    const puts: unknown[] = [];
    const store = new KeymapStore({
      get: async () => (await gate.promise, stored),
      put: async (_k, v) => void puts.push(v),
    });
    const early = store.update((current) => new Map([...current, ["ctrl+alt+x", "tab.close"]]));
    gate.resolve();
    await early;
    expect([...store.overrides]).toEqual([
      ["shift+super+n", "tab.new"],
      ["super+t", null],
      ["ctrl+alt+x", "tab.close"],
    ]);
    expect(puts.at(-1)).toEqual({ version: KEYMAP_VERSION, bindings: [...store.overrides] });
  });

  test("a keymap from a newer build is left untouched", async () => {
    const storage = memoryStore();
    const newer = { version: KEYMAP_VERSION + 1, bindings: [["super+shift+n", "tab.new"]] };
    await storage.put("keymap", newer);
    const store = new KeymapStore(storage);
    await store.loaded;
    expect(store.overrides.size).toBe(0);
    expect(await storage.get("keymap")).toEqual(newer);
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
