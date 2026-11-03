const ESC = 0x1b;

/** True when the bytes hold DECSCUSR with no parameter or 0 (`ESC [ q`, `ESC [ 0 SP q`): a reset to the default cursor. */
export function resetsCursor(bytes: Uint8Array): boolean {
  for (let index = 0; index + 2 < bytes.length; index++) {
    if (bytes[index] !== ESC || bytes[index + 1] !== 0x5b) continue;
    let at = index + 2;
    while (bytes[at] === 0x30) at++;
    if (bytes[at] === 0x20 && bytes[at + 1] === 0x71) return true;
  }
  return false;
}
