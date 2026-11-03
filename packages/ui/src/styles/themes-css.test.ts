import { expect, test } from "bun:test";
import { renderThemesCss } from "../../scripts/themes-css.ts";

test("themes.css is the generator's current output", async () => {
  const shipped = await Bun.file(new URL("./themes.css", import.meta.url)).text();
  expect(shipped).toBe(renderThemesCss());
});
