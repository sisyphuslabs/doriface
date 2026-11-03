import type { TerminalThemeColors } from "@wterm/react";

const toNumber = (value: string): number | null => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return hex === null ? null : Number.parseInt(hex[1] ?? "0", 16);
};

/** The terminal's effective colors from its computed --term-* vars, for libghostty's color queries. */
export function readThemeColors(element: HTMLElement): TerminalThemeColors | null {
  const style = getComputedStyle(element);
  const read = (name: string) => toNumber(style.getPropertyValue(name));
  const foreground = read("--term-fg");
  const background = read("--term-bg");
  // --term-cursor holds cursor-color when it is a plain color; with cursor-opacity it is a color-mix.
  const cursor = read("--term-cursor") ?? read("--doriface-theme-cursor") ?? foreground;
  const palette = Array.from({ length: 16 }, (_, index) => read(`--term-color-${index}`));
  if (foreground === null || background === null || cursor === null || palette.some((entry) => entry === null))
    return null;
  return { foreground, background, cursor, palette: palette.map((entry) => entry ?? 0) };
}
