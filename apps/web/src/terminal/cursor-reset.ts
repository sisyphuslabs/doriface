const ESC = 0x1b;
const CSI = 0x5b;
const SPACE = 0x20;
const Q = 0x71;
/** The longest sequence matched here is `ESC [ Ps SP q`; a split one fits in this many carried bytes. */
const MAX_CARRY = 8;

type Event = "reset" | "explicit";

/**
 * Reads output in order and reports whether its last cursor-shape event returned the cursor to the
 * default: DECSCUSR with no parameter or 0 (`ESC [ SP q`, `ESC [ 0 SP q`; without the space it is DECLL), a soft reset
 * (DECSTR, `ESC [ ! p`, which every attach replay starts with) or a full reset (RIS, `ESC c`). A later
 * explicit shape (`ESC [ 5 SP q`) in the same output wins; a sequence split across chunks is joined.
 */
export class CursorResets {
  #carry: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): boolean {
    const bytes = new Uint8Array(this.#carry.length + chunk.length);
    bytes.set(this.#carry);
    bytes.set(chunk, this.#carry.length);
    let last: Event | null = null;
    let incomplete = -1;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== ESC) continue;
      const [event, complete] = read(bytes, index);
      if (!complete) {
        incomplete = index;
        break;
      }
      if (event !== null) last = event;
    }
    this.#carry =
      incomplete === -1 || bytes.length - incomplete > MAX_CARRY ? new Uint8Array(0) : bytes.slice(incomplete);
    return last === "reset";
  }
}

/** The event at an ESC, and whether the bytes hold enough to decide it. */
function read(bytes: Uint8Array, at: number): readonly [Event | null, boolean] {
  const next = bytes[at + 1];
  if (next === undefined) return [null, false];
  if (next === 0x63) return ["reset", true];
  if (next !== CSI) return [null, true];
  let index = at + 2;
  if (bytes[index] === 0x21) {
    const final = bytes[index + 1];
    return final === undefined ? [null, false] : [final === 0x70 ? "reset" : null, true];
  }
  let digits = "";
  while (index < bytes.length && (bytes[index] ?? 0) >= 0x30 && (bytes[index] ?? 0) <= 0x39) {
    digits += String.fromCharCode(bytes[index] ?? 0x30);
    index++;
  }
  const first = bytes[index];
  if (first === undefined) return [null, false];
  if (first !== SPACE) return [null, true];
  const final = bytes[index + 1];
  if (final === undefined) return [null, false];
  if (final !== Q) return [null, true];
  return [Number(digits || "0") === 0 ? "reset" : "explicit", true];
}
