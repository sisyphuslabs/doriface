import { describe, expect, test } from "bun:test";
import { BUILTIN_PALETTES } from "./builtins.ts";
import { contrast, parseRgba } from "./color.ts";
import { themeVariables } from "./css.ts";
import { AA_GRAPHIC, AA_TEXT, flatten, worstContrast } from "./guard.ts";
import { resolveTheme } from "./resolve.ts";

test("contrast follows WCAG 2.2", () => {
  expect(contrast(0x000000, 0xffffff)).toBeCloseTo(21, 5);
  expect(contrast(0x777777, 0xffffff)).toBeCloseTo(4.48, 2);
});

describe.each(Object.entries(BUILTIN_PALETTES))("%s meets WCAG 2.2 AA", (_, palette) => {
  const theme = resolveTheme(palette);
  const vars = themeVariables(theme);
  const role = (name: string): string => {
    const value = vars[name];
    if (value === undefined) throw new Error(`missing --${name}`);
    return value;
  };
  const base = parseRgba(theme.roles.background)?.rgb ?? 0;
  const surfaces = ["canvas", "surface", "chrome", "popover", "raised"].map((name) => flatten(role(name), base));

  test.each(["foreground", "muted-foreground", "brand", "destructive"])("--%s text on every surface", (name) => {
    expect(worstContrast(role(name), surfaces)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(["input", "ring", "status-working", "status-blocked", "status-done", "status-idle"])(
    "--%s edge or glyph on every surface",
    (name) => {
      expect(worstContrast(role(name), surfaces)).toBeGreaterThanOrEqual(AA_GRAPHIC);
    },
  );

  test("primary button label", () => {
    expect(worstContrast(role("primary-foreground"), [flatten(role("primary"), base)])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(["working", "blocked", "done", "idle"])("%s chip label on its own tint", (status) => {
    const chips = surfaces.map((surface) => flatten(`${role(`status-${status}`)}26`, surface));
    expect(worstContrast(role(`status-${status}-text`), chips)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test("terminal default text", () => {
    expect(worstContrast(role("term-fg"), [flatten(role("term-bg"), base)])).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
