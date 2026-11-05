import { describe, expect, test } from "bun:test";
import { terminalCss } from "./render-css.ts";

describe("terminalCss font families", () => {
  test("escapes quotes and backslashes in family names", () => {
    const css = terminalCss(new Map([["font-family", ['Odd "Name" \\']]]));
    expect(css).toContain('--term-font-family: "Odd \\"Name\\" \\\\", var(--font-term);');
  });

  test("a style family falls back to the configured base family", () => {
    const css = terminalCss(new Map([["font-family-bold", ["Bold Face"]]]));
    expect(css).toContain('font-family: "Bold Face", var(--term-font-family);');
  });

  test("Ghostty-quoted families are names, and fallback order is preserved (#387)", () => {
    const css = terminalCss(
      new Map([
        ["font-family", ["'GeistMono Nerd Font Mono'", '"IBM Plex Sans KR"']],
        ["font-family-bold", ["'Bold Face'"]],
      ]),
    );
    expect(css).toContain('--term-font-family: "GeistMono Nerd Font Mono", "IBM Plex Sans KR", var(--font-term);');
    expect(css).toContain('font-family: "Bold Face", var(--term-font-family);');
  });
});
