/**
 * What a person may type into a custom key: a chord ("Ctrl+X", "Alt+Shift+A", "F5", "PgUp") or, when no word names a
 * key, the text itself. Parsing is total and pure, and returns the bytes the terminal will receive rather than
 * anything that is evaluated later: a custom key can never run code.
 */

export interface ParsedKey {
  readonly bytes: string;
  /** The key as the settings show it, canonicalised from what was typed. */
  readonly label: string;
}

export type KeyInput =
  | { readonly kind: "ok"; readonly key: ParsedKey }
  | { readonly kind: "error"; readonly reason: string };

/** The longest literal text one key may send, so a stray paste cannot turn into a key that types a file. */
export const MAX_TEXT_BYTES = 64;

/** Named keys, in xterm's own sequences, as a hardware keyboard sends them. */
const NAMED: Readonly<Record<string, { readonly bytes: string; readonly label: string }>> = {
  esc: { bytes: "\u001b", label: "Esc" },
  escape: { bytes: "\u001b", label: "Esc" },
  tab: { bytes: "\t", label: "Tab" },
  enter: { bytes: "\r", label: "Enter" },
  return: { bytes: "\r", label: "Enter" },
  backspace: { bytes: "\u007f", label: "Backspace" },
  space: { bytes: " ", label: "Space" },
  home: { bytes: "\u001b[H", label: "Home" },
  end: { bytes: "\u001b[F", label: "End" },
  pgup: { bytes: "\u001b[5~", label: "PgUp" },
  pageup: { bytes: "\u001b[5~", label: "PgUp" },
  pgdn: { bytes: "\u001b[6~", label: "PgDn" },
  pagedown: { bytes: "\u001b[6~", label: "PgDn" },
  del: { bytes: "\u001b[3~", label: "Del" },
  delete: { bytes: "\u001b[3~", label: "Del" },
  ins: { bytes: "\u001b[2~", label: "Ins" },
  insert: { bytes: "\u001b[2~", label: "Ins" },
  up: { bytes: "\u001b[A", label: "↑" },
  down: { bytes: "\u001b[B", label: "↓" },
  right: { bytes: "\u001b[C", label: "→" },
  left: { bytes: "\u001b[D", label: "←" },
  f1: { bytes: "\u001bOP", label: "F1" },
  f2: { bytes: "\u001bOQ", label: "F2" },
  f3: { bytes: "\u001bOR", label: "F3" },
  f4: { bytes: "\u001bOS", label: "F4" },
  f5: { bytes: "\u001b[15~", label: "F5" },
  f6: { bytes: "\u001b[17~", label: "F6" },
  f7: { bytes: "\u001b[18~", label: "F7" },
  f8: { bytes: "\u001b[19~", label: "F8" },
  f9: { bytes: "\u001b[20~", label: "F9" },
  f10: { bytes: "\u001b[21~", label: "F10" },
  f11: { bytes: "\u001b[23~", label: "F11" },
  f12: { bytes: "\u001b[24~", label: "F12" },
};

type Modifier = "ctrl" | "alt" | "shift";

const MODIFIER_WORDS: Readonly<Record<string, Modifier>> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  opt: "alt",
  option: "alt",
  meta: "alt",
  cmd: "alt",
  command: "alt",
  super: "alt",
  shift: "shift",
};

const LABEL: Readonly<Record<Modifier, string>> = { ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
const ORDER: readonly Modifier[] = ["ctrl", "alt", "shift"];

function labelOf(modifiers: ReadonlySet<Modifier>, base: string): string {
  return [...ORDER.filter((modifier) => modifiers.has(modifier)).map((modifier) => LABEL[modifier]), base].join("+");
}

function modifierOf(word: string): Modifier | undefined {
  return MODIFIER_WORDS[word.toLowerCase()];
}

/** Ctrl and a single character, as a terminal's control byte; `<` and `?` are the two off-by-one cases readline knows. */
function control(char: string): string {
  if (char === " ") return "\u0000";
  if (char === "?") return "\u007f";
  const code = char.toUpperCase().charCodeAt(0);
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : char;
}

/** xterm's modifier parameter for an escape sequence: 1 + Shift 1 + Alt 2 + Ctrl 4. */
function parameter(modifiers: ReadonlySet<Modifier>): number {
  return 1 + (modifiers.has("shift") ? 1 : 0) + (modifiers.has("alt") ? 2 : 0) + (modifiers.has("ctrl") ? 4 : 0);
}

/** The modified form of a key whose plain bytes are an xterm sequence: `\e[5~` with Ctrl is `\e[5;5~`. */
const ESC = "\u001b";

/** The modified form of a key whose plain bytes are an xterm sequence: `\e[5~` with Ctrl is `\e[5;5~`. */
function modifiedSequence(bytes: string, modifiers: ReadonlySet<Modifier>): string | null {
  if (!bytes.startsWith(ESC)) return null;
  const rest = bytes.slice(1);
  const final = rest.slice(-1);
  const body = rest.slice(1, -1).replace(/^\[/u, "");
  if (rest.startsWith("[")) {
    if (!/^[A-Za-z~]$/u.test(final) || !/^\d*$/u.test(body)) return null;
    return `${ESC}[${body === "" ? "1" : body};${parameter(modifiers)}${final}`;
  }
  if (rest.startsWith("O") && rest.length === 2 && /^[A-Z]$/u.test(final)) {
    return `${ESC}[1;${parameter(modifiers)}${final}`;
  }
  return null;
}

function typing(modifiers: ReadonlySet<Modifier>, base: string, label: string): KeyInput {
  const text = modifiers.has("shift") ? base.toUpperCase() : base;
  const controlBytes = modifiers.has("ctrl") ? control(text) : text;
  const bytes = modifiers.has("alt") ? `\u001b${controlBytes}` : controlBytes;
  if (bytes.length > MAX_TEXT_BYTES) {
    return { kind: "error", reason: `A key sends at most ${MAX_TEXT_BYTES} characters.` };
  }
  return { kind: "ok", key: { bytes, label: labelOf(modifiers, label) } };
}

function chord(modifiers: ReadonlySet<Modifier>, base: string, baseLabel: string): KeyInput {
  if (modifiers.size === 0) return { kind: "ok", key: { bytes: base, label: baseLabel } };
  if (baseLabel === "Tab" && modifiers.size === 1 && modifiers.has("shift")) {
    return { kind: "ok", key: { bytes: "\u001b[Z", label: "Shift+Tab" } };
  }
  const sequence = modifiedSequence(base, modifiers);
  if (sequence !== null) {
    return { kind: "ok", key: { bytes: sequence, label: labelOf(modifiers, baseLabel) } };
  }
  return typing(modifiers, base, baseLabel);
}

/**
 * Reads one custom key. A word naming a key or a modifier makes a chord; anything else is the literal text the key
 * sends, so a person can put "git status" on the bar as easily as Ctrl+C.
 */
export function parseKeyInput(input: string): KeyInput {
  const text = input.trim();
  if (text === "") return { kind: "error", reason: "Type the keys this key sends." };
  const caret = /^\^(.)$/u.exec(text);
  if (caret !== null) return typing(new Set<Modifier>(["ctrl"]), caret[1] ?? "", caret[1] ?? "");
  const parts = text === "+" ? [text] : text.split("+").map((part) => part.trim());
  const base = parts[parts.length - 1] ?? "";
  const modifiers = new Set<Modifier>();
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierOf(part);
    if (modifier === undefined) {
      return { kind: "error", reason: `"${part}" is not a modifier. Use Ctrl, Alt or Shift.` };
    }
    modifiers.add(modifier);
  }
  if (base === "") return { kind: "error", reason: "End the key with what it presses, e.g. Ctrl+X." };
  const named = NAMED[base.toLowerCase()];
  if (named !== undefined) return chord(modifiers, named.bytes, named.label);
  if ([...base].length === 1) {
    // A chord names a physical key, so Alt+X is option+x whatever case it was typed in; Shift still capitalises it.
    return typing(modifiers, modifiers.size > 0 ? base.toLowerCase() : base, base);
  }
  if (modifiers.size > 0) {
    return { kind: "error", reason: `"${base}" is not a key. Name a letter, F1 to F12, Esc, Tab or an arrow.` };
  }
  return typing(modifiers, text, text);
}
