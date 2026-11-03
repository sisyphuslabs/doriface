/** Bytes for each extra key the phone keyboard lacks. */
const SEQUENCES: Readonly<Record<string, string>> = {
  esc: "\u001b",
  tab: "\t",
  up: "\u001b[A",
  down: "\u001b[B",
  right: "\u001b[C",
  left: "\u001b[D",
};

export const MODIFIERS = new Set(["ctrl", "alt"]);

export function keySequence(id: string): string | undefined {
  return SEQUENCES[id];
}

/** Applies latched ctrl/alt to typed input: ctrl turns a letter into its control code, alt prefixes ESC. */
export function applyModifiers(data: string, latched: ReadonlySet<string>): string {
  let out = data;
  if (latched.has("ctrl") && out.length === 1) {
    const code = out.toUpperCase().charCodeAt(0);
    if (code >= 0x40 && code <= 0x5f) out = String.fromCharCode(code & 0x1f);
  }
  return latched.has("alt") ? `\u001b${out}` : out;
}
