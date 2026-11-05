import { describe, expect, test } from "bun:test";
import { actionFor, decodeZigString, sendBytes } from "./actions.ts";
import {
  importKeybinds,
  isChanged,
  parseKeybinds,
  resetAction,
  resolveKeymap,
  serializeKeybinds,
  withBinding,
} from "./keymap.ts";

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
    expect(sendBytes(parsed.overrides.get("super+k") ?? "")).toEqual(
      new Uint8Array([0x61, 0x09, 0x62, 0x5c, 0x63, ...new TextEncoder().encode("\u{1F600}")]),
    );
    expect(parsed.overrides.has("super+l")).toBe(false);
  });

  test("text: follows Zig for surrogates, leading zeros and raw bytes", () => {
    expect(decodeZigString("\\u{D800}")).toBeNull();
    expect(decodeZigString("\\u{DFFF}")).toBeNull();
    expect(decodeZigString("\\u{0000041}")).toBe("A");
    expect(decodeZigString("\\u{110000}")).toBeNull();
    expect(sendBytes(`send:${decodeZigString("\\x80\\xffé") ?? ""}`)).toEqual(new Uint8Array([0x80, 0xff, 0xc3, 0xa9]));
    expect(sendBytes("send:\u001bb")).toEqual(new Uint8Array([0x1b, 0x62]));
  });

  test("send labels show control bytes as \\xNN", () => {
    const parsed = parseKeybinds("keybind = super+j=text:\\x1b[A\\x7fz");
    expect(actionFor(parsed.overrides.get("super+j") ?? "")?.label).toBe('Send "\\x1b[A\\x7fz"');
  });

  test("send labels show UTF-8 text and \\xNN only for bytes that are not UTF-8", () => {
    const parsed = parseKeybinds("keybind = super+j=text:héllo 😀 世界\nkeybind = super+k=text:\\x80ok\\xc3");
    expect(actionFor(parsed.overrides.get("super+j") ?? "")?.label).toBe('Send "héllo 😀 世界"');
    expect(actionFor(parsed.overrides.get("super+k") ?? "")?.label).toBe('Send "\\x80ok\\xc3"');
  });

  test("a parameter doriface does not have is unknown, not another action", () => {
    expect(parseKeybinds("keybind = super+x=goto_tab:12").lines[0]?.status).toBe("unknown");
    expect(parseKeybinds("keybind = super+x=new_split:auto").lines[0]?.status).toBe("unknown");
    expect(parseKeybinds("keybind = super+x=new_split:down").lines[0]?.status).toBe("applies");
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

  test("export writes bytes from 0x7f up as \\xNN, so the bytes survive a round trip", () => {
    const parsed = parseKeybinds("keybind = super+j=text:\\x80é\\x7f");
    const text = serializeKeybinds(parsed.overrides);
    expect(text).toContain("text:\\x80\\xc3\\xa9\\x7f");
    const again = parseKeybinds(text).overrides.get("super+j") ?? "";
    expect(sendBytes(again)).toEqual(new Uint8Array([0x80, 0xc3, 0xa9, 0x7f]));
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
