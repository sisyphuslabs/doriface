import type { Page } from "@playwright/test";

/**
 * Original 568-byte TrueType test font, licensed AGPL-3.0-only with this repository. No third-party outlines.
 * 1000 units/em, ascent 800, descent 200, no line gap, advance 900. W and the three PUA ranges draw a triangle;
 * .notdef is empty. Keeping this in the spec bundle makes fallback tests independent of installed fonts.
 */
export const FIXTURE_FONT = [
  "AAEAAAAKAIAAAwAgT1MvMgV9BXUAAAG4AAAAYGNtYXAAMoOdAAAArAAAAFhnbHlmqR9CjQAAAQQAAAAgaGVhZGKWRAUAAAEk",
  "AAAANmhoZWEDIgK/AAABXAAAACRobXR4BdwAAAAAAYAAAAAIbG9jYQAQAAAAAAGIAAAABm1heHAABAAEAAABkAAAACBuYW1l",
  "AAYAAAAAAbAAAAAGcG9zdAADAAAAAAIYAAAAIAAAAAEAAwAKAAAADAAMAAAAAABMAAAAAAAAAAUAAABXAAAAVwAAAAEAAOCw",
  "AADgsAAAAAEAAPAVAADwFQAAAAEAAPB7AADwewAAAAEADwABAA8AAQAAAAEAAQAAAAADhAMgAAIAAAEBAQAAA4T+PgAAAAAD",
  "IAAAAAABAAAAAAAAcJh4j18PPPUAAAPoAAAAAAAAAAAAAAAAAAAAAAAAAAADhAMgAAAACAACAAAAAAAAAAEAAAMg/zgAAAOE",
  "AAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAlgAAAOEAAAAAAAAABAAAAABAAAAAgADAAEAAAAAAAEAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAGAAAABAJYAZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA",
  "AAAAAAMg/zgAAAMgAMgAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
].join("");

export async function loadFixtureFont(page: Page): Promise<void> {
  await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const face = await new FontFace("Terminal PUA Fixture", bytes).load();
    document.fonts.add(face);
  }, FIXTURE_FONT);
}
