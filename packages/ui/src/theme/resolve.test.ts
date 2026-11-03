import { describe, expect, test } from "bun:test";
import { graphite, paper } from "./builtins.ts";
import { parseThemeFile, ThemeFileError } from "./palette.ts";
import { resolveTheme, type ResolvedTheme } from "./resolve.ts";

// herdr-app's resolved tables for its two default presets (resolve() over settings.rs palettes).
const HERDR_APP: Record<"graphite" | "paper", Record<string, string>> = {
  graphite: {
    background: "#17191d",
    terminal_foreground: "#d2d4d9",
    foreground: "#eeeeef",
    surface: "#17191d",
    canvas: "#131518",
    chrome: "#101114",
    popover: "#25272b",
    raised: "#2c2e31",
    hover: "#ffffff0e",
    selected: "#ffffff17",
    border: "#ffffff18",
    input: "#ffffff24",
    muted: "#98999b",
    dim: "#696a6d",
    accent: "#96b2d7",
    accent_foreground: "#17191d",
    solid: "#eeeeef",
    solid_foreground: "#111215",
    ring: "#aeaeb0",
    selection: "#394454",
    cursor: "#d2d4d9",
    working: "#e5c07b",
    blocked: "#f0705f",
    done: "#76a8ff",
    idle: "#696a6d",
    unknown: "#696a6d",
    ansi0: "#45484f",
    ansi1: "#dc8c95",
    ansi2: "#a6bd91",
    ansi3: "#d8be87",
    ansi4: "#96b2d7",
    ansi5: "#b5a2ce",
    ansi6: "#8cbdc3",
    ansi7: "#d2d4d9",
    ansi8: "#818793",
    ansi9: "#f0a5ad",
    ansi10: "#bad5a2",
    ansi11: "#ead2a1",
    ansi12: "#b0cbef",
    ansi13: "#cbb7e6",
    ansi14: "#a4d5db",
    ansi15: "#f0f0f2",
  },
  paper: {
    background: "#ffffff",
    terminal_foreground: "#25272c",
    foreground: "#1b1b1e",
    surface: "#ffffff",
    canvas: "#fafaf9",
    chrome: "#f1f1ee",
    popover: "#ffffff",
    raised: "#f6f6f6",
    hover: "#0000000c",
    selected: "#00000012",
    border: "#00000017",
    input: "#00000026",
    muted: "#69696a",
    dim: "#969698",
    accent: "#1f62d0",
    accent_foreground: "#ffffff",
    solid: "#1b1b1e",
    solid_foreground: "#ffffff",
    ring: "#5f5f62",
    selection: "#cfdcf5",
    cursor: "#25272c",
    working: "#9a6700",
    blocked: "#c93c2c",
    done: "#2f6fe4",
    idle: "#a8a8aa",
    unknown: "#a8a8aa",
    ansi0: "#25272c",
    ansi1: "#c62a2a",
    ansi2: "#1a7f37",
    ansi3: "#8f5d00",
    ansi4: "#1f62d0",
    ansi5: "#7a45c8",
    ansi6: "#0f6f74",
    ansi7: "#5f6068",
    ansi8: "#7b7e87",
    ansi9: "#d1242f",
    ansi10: "#1f883d",
    ansi11: "#9a6700",
    ansi12: "#0969da",
    ansi13: "#8250df",
    ansi14: "#1b7c83",
    ansi15: "#111214",
  },
};

function flat(theme: ResolvedTheme): Record<string, string> {
  const out: Record<string, string> = { ...theme.roles };
  theme.ansi.forEach((value, index) => {
    out[`ansi${index}`] = value;
  });
  return out;
}

describe("resolveTheme matches herdr-app", () => {
  test.each([
    ["graphite", graphite],
    ["paper", paper],
  ] as const)("%s resolves to herdr-app's 42 values", (name, palette) => {
    expect(flat(resolveTheme(palette))).toEqual(HERDR_APP[name]);
  });

  test("light follows the palette background", () => {
    expect(resolveTheme(paper).light).toBe(true);
    expect(resolveTheme(graphite).light).toBe(false);
  });
});

describe("herdr-app theme files", () => {
  const ansi: readonly string[] = Array.from(
    { length: 16 },
    (_, index) => `#${(index * 0x0f0f0f).toString(16).padStart(6, "0")}`,
  );
  const at = (index: number): string => ansi[index] ?? "";

  test("a file with no status takes working/blocked/done from ansi3/1/4 and applies overrides last", () => {
    const theme = resolveTheme(
      parseThemeFile({
        background: "#ffffff",
        foreground: "#c0c0c0",
        selection: "#000080",
        ansi,
        colors: { background: "#000000", ansi2: "#123456", mod_tint: "#abcdef80" },
      }),
    );
    expect(theme.light).toBe(true);
    expect(theme.roles.background).toBe("#000000");
    expect(theme.roles.surface).toBe("#ffffff");
    expect(theme.roles.cursor).toBe("#c0c0c0");
    expect([theme.roles.working, theme.roles.blocked, theme.roles.done]).toEqual([at(3), at(1), at(4)]);
    expect(theme.ansi[2]).toBe("#123456");
    expect(theme.extra).toEqual({ mod_tint: "#abcdef80" });
  });

  test.each([
    ["an unknown field", { background: "#000000", foreground: "#ffffff", selection: "#333333", ansi, font: "x" }],
    [
      "fifteen ansi colours",
      { background: "#000000", foreground: "#ffffff", selection: "#333333", ansi: ansi.slice(1) },
    ],
    ["a short hex", { background: "#000", foreground: "#ffffff", selection: "#333333", ansi }],
    [
      "a bad override",
      { background: "#000000", foreground: "#ffffff", selection: "#333333", ansi, colors: { x: "red" } },
    ],
  ])("rejects %s", (_, file) => {
    expect(() => parseThemeFile(file)).toThrow(ThemeFileError);
  });
});
