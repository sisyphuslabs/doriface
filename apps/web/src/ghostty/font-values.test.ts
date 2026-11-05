import { describe, expect, test } from "bun:test";
import { fontFamilyName, fontPixels } from "./values.ts";

describe("Ghostty font values", () => {
  test.each([
    ["MacIntel", 16],
    ["iPhone", 16],
    ["iPad", 16],
    ["Linux x86_64", (16 * 96) / 72],
    ["Win32", (16 * 96) / 72],
  ])("16 points use native logical pixels on %s (#393)", (platform, pixels) => {
    expect(fontPixels(16, platform)).toBe(pixels);
  });

  test.each([
    ["'GeistMono Nerd Font Mono'", "GeistMono Nerd Font Mono"],
    ['"IBM Plex Sans KR"', "IBM Plex Sans KR"],
    ["Font's Name", "Font's Name"],
    ['Odd "Name" \\', 'Odd "Name" \\'],
    ["'Unclosed", "'Unclosed"],
  ])("family %s retains the actual name (#387)", (value, expected) => {
    expect(fontFamilyName(value)).toBe(expected);
  });
});
