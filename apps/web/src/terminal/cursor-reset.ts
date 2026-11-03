const ESC = 0x1b;
const CSI = 0x5b;

/**
 * True when the bytes return the cursor to its default shape: DECSCUSR with no parameter or 0
 * (`ESC [ q`, `ESC [ 0 SP q`), a soft reset (DECSTR, `ESC [ ! p`, which every attach replay starts
 * with), or a full reset (RIS, `ESC c`).
 */
export function resetsCursor(bytes: Uint8Array): boolean {
  for (let index = 0; index + 1 < bytes.length; index++) {
    if (bytes[index] !== ESC) continue;
    if (bytes[index + 1] === 0x63) return true;
    if (bytes[index + 1] !== CSI) continue;
    if (bytes[index + 2] === 0x21 && bytes[index + 3] === 0x70) return true;
    let at = index + 2;
    while (bytes[at] === 0x30) at++;
    if (bytes[at] === 0x20 && bytes[at + 1] === 0x71) return true;
  }
  return false;
}
