import { describe, expect, test } from "bun:test";
import { effective } from "./config.ts";
import { mergeConfig, parseGhosttyConfig } from "./parse.ts";
import { serializeGhosttyConfig } from "./serialize.ts";

// Shaped like configs people publish: comments, quoted families, fallbacks, ligatures off, a full palette.
const SAMPLE = `# ~/.config/ghostty/config
font-family = "JetBrains Mono"
font-family = Symbols Nerd Font Mono
font-family = Apple Color Emoji
font-size = 13.5
font-feature = -calt
font-feature = -liga, -dlig
font-variation = wght=450
adjust-cell-height = 10%

cursor-style = bar
cursor-style-blink = false
cursor-color = #f5e0dc

background = 1e1e2e
foreground = #cdd6f4
palette = 0=#45475a
palette = 1=#f38ba8
palette = 0x2=#a6e3a1
palette = 15=#a6adc8
selection-background = 353749
background-opacity = 0.95
window-padding-x = 4,8
window-padding-balance = true
macos-titlebar-style = tabs
copy-on-select = clipboard
keybind = cmd+t=new_tab
`;

describe("parseGhosttyConfig", () => {
  const parsed = parseGhosttyConfig(SAMPLE);
  const statusOf = (key: string) => parsed.lines.filter((line) => line.key === key).map((line) => line.status);

  test("repeated font-family lines become an ordered fallback list", () => {
    expect(effective(parsed.config, "font-family")).toEqual([
      "JetBrains Mono",
      "Symbols Nerd Font Mono",
      "Apple Color Emoji",
    ]);
  });

  test("palette entries accumulate, including prefixed indices", () => {
    expect(effective(parsed.config, "palette")).toEqual(["0=#45475a", "1=#f38ba8", "0x2=#a6e3a1", "15=#a6adc8"]);
  });

  test("comments and blank lines are ignored; line numbers point at the source", () => {
    expect(parsed.lines.find((line) => line.key === "font-size")?.line).toBe(5);
    expect(parsed.lines.some((line) => line.key.startsWith("#"))).toBe(false);
  });

  test("each line is classified as applying, unsupported or unknown", () => {
    expect(statusOf("cursor-style")).toEqual(["applies"]);
    expect(statusOf("window-padding-balance")).toEqual(["unsupported"]);
    expect(statusOf("macos-titlebar-style")).toEqual(["unknown"]);
    expect(statusOf("keybind")).toEqual(["unknown"]);
    expect(parsed.config.has("macos-titlebar-style")).toBe(false);
  });

  test.each([
    ["cursor-style = beam", "cursor-style"],
    ["palette = 16=#ffffff", "palette"],
    ["palette = 3=notacolor", "palette"],
    ["font-size = huge", "font-size"],
    ["background-opacity = 1.5", "background-opacity"],
    ["theme = light:Day", "theme"],
    ["theme = Catppuccin Mocha", "theme"],
    ["background = red", "background"],
    [
      "window-padding-x = 10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "window-padding-x",
    ],
    [
      "adjust-cell-height = 10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "adjust-cell-height",
    ],
    [
      "font-feature = ss01=10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "font-feature",
    ],
    ["theme = light:Day,light:Paper", "theme"],
    ["font-size", "font-size"],
  ])("rejects %p", (line, key) => {
    const result = parseGhosttyConfig(line);
    expect(result.lines[0]?.status).toBe("invalid");
    expect(result.config.has(key)).toBe(false);
  });

  test("an empty value keeps the key's support label", () => {
    const resets = parseGhosttyConfig('scrollback-limit = ""\nwindow-padding-balance = ""');
    expect(resets.lines.map((line) => line.status)).toEqual(["new-terminals", "unsupported"]);
  });

  test("light:X,dark:Y themes are accepted in either order", () => {
    expect(parseGhosttyConfig("theme = dark:Night, light:Day").lines[0]?.status).toBe("applies");
  });

  test("an empty value clears a repeatable list and merging returns it to the default", () => {
    const current = parseGhosttyConfig("font-family = Iosevka").config;
    const cleared = parseGhosttyConfig('font-family = ""').config;
    expect(effective(mergeConfig(current, cleared), "font-family")).toEqual([]);
    const replaced = parseGhosttyConfig('font-family = ""\nfont-family = Fira Code').config;
    expect(effective(mergeConfig(current, replaced), "font-family")).toEqual(["Fira Code"]);
  });
});

describe("serializeGhosttyConfig", () => {
  test("export then import reproduces the same config", () => {
    const { config } = parseGhosttyConfig(SAMPLE);
    const again = parseGhosttyConfig(serializeGhosttyConfig(config)).config;
    expect(new Map(again)).toEqual(new Map(config));
  });

  test("values with surrounding spaces are quoted", () => {
    const text = serializeGhosttyConfig(new Map([["font-family", [" Spaced"]]]));
    expect(text).toContain('font-family = " Spaced"');
  });
});
