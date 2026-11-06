import { expect, test } from "bun:test";
import { applyModifiers, hostPlatform, keySequence } from "./keys.ts";

const latched = (...ids: string[]): ReadonlySet<string> => new Set(ids);

test.each([
  ["esc", "\u001b"],
  ["tab", "\t"],
  ["enter", "\r"],
  ["backspace", "\u007f"],
  ["clear", "\u000c"],
  ["up", "\u001b[A"],
  ["down", "\u001b[B"],
  ["right", "\u001b[C"],
  ["left", "\u001b[D"],
  ["tilde", "~"],
  ["pipe", "|"],
  ["slash", "/"],
  ["dash", "-"],
] as const)("the %p key sends %j", (id, bytes) => {
  expect(keySequence(id)).toBe(bytes);
});

test.each([
  ["c", ["ctrl"], "\u0003"],
  ["C", ["ctrl"], "\u0003"],
  ["[", ["ctrl"], "\u001b"],
  ["?", ["ctrl"], "\u007f"],
  [" ", ["ctrl"], "\u0000"],
  ["a", ["shift"], "A"],
  ["\t", ["shift"], "\u001b[Z"],
  ["x", ["alt"], "\u001bx"],
  ["x", ["cmd"], "\u001bx"],
  // A modified arrow carries the xterm modifier parameter: 1 + shift 1 + alt 2 + ctrl 4.
  ["\u001b[A", ["shift"], "\u001b[1;2A"],
  ["\u001b[B", ["alt"], "\u001b[1;3B"],
  ["\u001b[D", ["ctrl"], "\u001b[1;5D"],
  ["\u001b[C", ["ctrl", "shift"], "\u001b[1;6C"],
  ["\u001b[A", ["ctrl", "shift", "alt"], "\u001b[1;8A"],
  ["ls", [], "ls"],
  ["\u001b[A", [], "\u001b[A"],
  ["\r", ["shift"], "\r"],
] as const)("%j with %p latched sends %j", (data, mods, bytes) => {
  expect(applyModifiers(data, latched(...mods), "other")).toEqual({ kind: "write", data: bytes });
});

// A Korean soft keyboard types Hangul letters, not Latin ones: with a modifier latched, the letter names the key it sits on
// in the standard 2-set (두벌식) layout, so ctrl+ㅊ is ^C as ctrl+c is (#652).
test.each([
  ["ㅊ", ["ctrl"], "\u0003"],
  ["ㅁ", ["ctrl"], "\u0001"],
  ["ㅇ", ["ctrl"], "\u0004"],
  ["ㄹ", ["ctrl"], "\u0006"],
  ["ㅋ", ["ctrl"], "\u001a"],
  ["ㅠ", ["ctrl"], "\u0002"],
  ["ㅂ", ["ctrl"], "\u0011"],
  ["ㅔ", ["ctrl"], "\u0010"],
  ["ㅑ", ["ctrl"], "\t"],
  ["ㅡ", ["ctrl"], "\r"],
  ["ㅊ", ["alt"], "\u001bc"],
  ["ㅊ", ["cmd"], "\u001bc"],
  ["ㅎ", ["ctrl", "alt"], "\u001b\u0007"],
  ["ㄱ", ["alt", "shift"], "\u001bR"],
  // A doubled consonant and ㅒ ㅖ are the shifted key: Shift is part of the letter.
  ["ㄲ", ["alt"], "\u001bR"],
  ["ㅃ", ["ctrl"], "\u0011"],
  ["ㅖ", ["alt"], "\u001bP"],
] as const)("Hangul %j with %p latched sends %j", (data, mods, bytes) => {
  expect(applyModifiers(data, latched(...mods), "other")).toEqual({ kind: "write", data: bytes });
});

test.each([
  ["ㅊ", []],
  ["ㅊ", ["shift"]],
  ["차", ["ctrl"]],
  ["한글", ["ctrl"]],
] as const)("%j with %p latched is typed as written", (data, mods) => {
  expect(applyModifiers(data, latched(...mods), "other")).toEqual({ kind: "write", data });
});

test("cmd+ㅍ on a mac host is the paste chord, as cmd+v is", () => {
  expect(applyModifiers("ㅍ", latched("cmd"), "mac")).toEqual({ kind: "paste" });
  expect(applyModifiers("ㅍ", latched("ctrl", "shift"), "other")).toEqual({ kind: "paste" });
});

test("cmd+v on a mac host and ctrl+shift+v elsewhere paste the device clipboard", () => {
  expect(applyModifiers("v", latched("cmd"), "mac")).toEqual({ kind: "paste" });
  expect(applyModifiers("v", latched("ctrl", "shift"), "other")).toEqual({ kind: "paste" });
});

test.each(["mac", "other"] as const)(
  "ctrl+v on a %p host sends ^V (vim's visual block, bash's quoted insert)",
  (host) => {
    expect(applyModifiers("v", latched("ctrl"), host)).toEqual({ kind: "write", data: "\u0016" });
    expect(applyModifiers("V", latched("ctrl"), host)).toEqual({ kind: "write", data: "\u0016" });
  },
);

test.each([
  ["buildMac", "mac"],
  ["Alexs-MacBook-Pro.local", "mac"],
  ["Mac-mini", "mac"],
  ["studio iMac", "mac"],
  ["darwin-box", "mac"],
  ["machine", "other"],
  ["emacs-dev", "other"],
  ["ubuntu-server", "other"],
] as const)("a core named %p is a %p host", (name, platform) => {
  expect(hostPlatform(name)).toBe(platform);
});
