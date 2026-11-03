/** Crockford base32, the alphabet of typed pairing codes. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ALIASES: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" };

/** Uppercases, drops spaces and dashes, maps look-alikes; null unless exactly 8 valid characters remain. */
export function normalizeCode(text: string): string | null {
  const code = [...text.toUpperCase().replace(/[\s-]/g, "")].map((char) => ALIASES[char] ?? char).join("");
  return code.length === 8 && [...code].every((char) => ALPHABET.includes(char)) ? code : null;
}

/** The first 3 characters name the relay pairing slot; the other 5 never leave the two devices. */
export function slotOf(code: string): string {
  return code.slice(0, 3);
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}
