/** Typed pairing codes (contract v1.1): 8 Crockford base32 characters, shown as `XXXX XXXX`. */

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAIR_CODE_LENGTH = 8;
export const PAIR_SLOT_LENGTH = 3;
export const PAIR_SLOT_PATTERN = /^[0-9A-HJKMNP-TV-Z]{3}$/;

/**
 * The canonical code for what a person typed: separators dropped, upper-cased, and the look-alikes Crockford decoding
 * folds (I and L to 1, O to 0). Undefined unless that leaves exactly 8 alphabet characters.
 */
export function normalizePairCode(typed: string): string | undefined {
  const code = typed.toUpperCase().replaceAll(/[\s-]/g, "").replaceAll(/[IL]/g, "1").replaceAll("O", "0");
  if (code.length !== PAIR_CODE_LENGTH) return undefined;
  return [...code].every((char) => CROCKFORD_ALPHABET.includes(char)) ? code : undefined;
}

/** The relay pairing slot: the code's first 3 characters. The other 5 are the secret and never reach the relay. */
export function pairSlotOf(code: string): string {
  return code.slice(0, PAIR_SLOT_LENGTH);
}
