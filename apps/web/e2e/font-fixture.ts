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

/** The big-endian uint32 sum a TrueType table checksum is, over `bytes` padded to four. */
function checksum(bytes: Uint8Array): number {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let at = 0; at < padded.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0;
  return sum;
}

/**
 * FIXTURE_FONT with every advance set to `units` (of its 1000 per em): hmtx, hhea's maximum and OS/2's average, with the
 * table checksums and head's adjustment written again, so the font stays valid.
 */
export function fixtureFontWithAdvance(units: number): Buffer {
  const font = Buffer.from(FIXTURE_FONT, "base64");
  const tables = new Map<string, { readonly record: number; readonly offset: number; readonly length: number }>();
  for (let index = 0; index < font.readUInt16BE(4); index++) {
    const record = 12 + 16 * index;
    const tag = font.toString("latin1", record, record + 4);
    tables.set(tag, { record, offset: font.readUInt32BE(record + 8), length: font.readUInt32BE(record + 12) });
  }
  const table = (tag: string) => {
    const found = tables.get(tag);
    if (found === undefined) throw new Error(`the fixture font has no ${tag} table`);
    return found;
  };
  const hhea = table("hhea").offset;
  font.writeUInt16BE(units, hhea + 10);
  for (let glyph = 0; glyph < font.readUInt16BE(hhea + 34); glyph++)
    font.writeUInt16BE(units, table("hmtx").offset + 4 * glyph);
  font.writeInt16BE(units, table("OS/2").offset + 2);
  const head = table("head").offset;
  font.writeUInt32BE(0, head + 8);
  for (const { record, offset, length } of tables.values()) {
    font.writeUInt32BE(checksum(font.subarray(offset, offset + length)), record + 4);
  }
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, head + 8);
  return font;
}

export async function loadFixtureFont(page: Page): Promise<void> {
  await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const face = await new FontFace("Terminal PUA Fixture", bytes).load();
    document.fonts.add(face);
  }, FIXTURE_FONT);
}
