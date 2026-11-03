/**
 * Triggers use Ghostty's syntax: modifiers ctrl, alt, shift, super joined by "+", then one key, e.g.
 * "super+shift+t". Keys are layout independent (from KeyboardEvent.code) so bindings survive layouts.
 */
export type Platform = "mac" | "other";

const MOD_ORDER = ["ctrl", "alt", "shift", "super"] as const;
type Mod = (typeof MOD_ORDER)[number];

const MOD_ALIASES: Readonly<Record<string, Mod>> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  opt: "alt",
  option: "alt",
  shift: "shift",
  super: "super",
  cmd: "super",
  command: "super",
};

/** Key names Ghostty and herdr-app write differently, folded to one spelling. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  pageup: "page_up",
  pagedown: "page_down",
  arrow_left: "left",
  arrow_right: "right",
  arrow_up: "up",
  arrow_down: "down",
  return: "enter",
  esc: "escape",
  equal: "=",
  minus: "-",
  plus: "+",
  comma: ",",
  period: ".",
  slash: "/",
  bracket_left: "[",
  bracket_right: "]",
  space: "space",
};

/** Shifted symbols on a US layout, so "ctrl++" and "ctrl+shift+=" are the same trigger. */
const SHIFTED: Readonly<Record<string, string>> = {
  "+": "=",
  "?": "/",
  "{": "[",
  "}": "]",
  "<": ",",
  ">": ".",
  _: "-",
};

const NAMED_KEYS = new Set([
  "enter",
  "tab",
  "escape",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "page_up",
  "page_down",
  "left",
  "right",
  "up",
  "down",
  "space",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
]);
const SYMBOL_KEYS = new Set(["=", "-", "[", "]", ",", ".", "/", ";", "'", "`", "\\"]);

function isKey(key: string): boolean {
  return /^[a-z0-9]$/.test(key) || NAMED_KEYS.has(key) || SYMBOL_KEYS.has(key);
}

/** Canonical form of a trigger, or null when it is not one. Accepts herdr-app's "cmd-shift-t" too. */
export function normalizeTrigger(text: string, herdrStyle = false): string | null {
  const raw = text.trim().toLowerCase();
  if (raw === "") return null;
  const parts = herdrStyle ? splitHerdr(raw) : splitGhostty(raw);
  const keyPart = parts.at(-1) ?? "";
  const mods = new Set<Mod>();
  for (const part of parts.slice(0, -1)) {
    const mod = MOD_ALIASES[part];
    if (mod === undefined) return null;
    mods.add(mod);
  }
  let key = KEY_ALIASES[keyPart] ?? keyPart;
  const unshifted = SHIFTED[key];
  if (unshifted !== undefined) {
    mods.add("shift");
    key = unshifted;
  }
  if (!isKey(key)) return null;
  return [...MOD_ORDER.filter((mod) => mods.has(mod)), key].join("+");
}

/** "ctrl++" ends with a literal plus; every other "+" separates. */
function splitGhostty(raw: string): string[] {
  if (raw.endsWith("++"))
    return [
      ...raw
        .slice(0, -2)
        .split("+")
        .filter((part) => part !== ""),
      "+",
    ];
  return raw === "+" ? ["+"] : raw.split("+");
}

/** "ctrl--" ends with a literal minus. */
function splitHerdr(raw: string): string[] {
  if (raw.endsWith("--"))
    return [
      ...raw
        .slice(0, -2)
        .split("-")
        .filter((part) => part !== ""),
      "-",
    ];
  return raw === "-" ? ["-"] : raw.split("-");
}

const CODE_KEYS: Readonly<Record<string, string>> = {
  Equal: "=",
  Minus: "-",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Backslash: "\\",
  Space: "space",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  PageUp: "page_up",
  PageDown: "page_down",
  Enter: "enter",
  NumpadEnter: "enter",
  Tab: "tab",
  Escape: "escape",
  Backspace: "backspace",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
};

/** The trigger a key event matches, or null for a lone modifier. */
export function triggerFromEvent(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): string | null {
  const code = event.code;
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3).toLowerCase()
    : /^Digit\d$/.test(code)
      ? code.slice(5)
      : /^F\d{1,2}$/.test(code)
        ? code.toLowerCase()
        : CODE_KEYS[code];
  if (key === undefined) return null;
  const mods: Mod[] = [];
  if (event.ctrlKey) mods.push("ctrl");
  if (event.altKey) mods.push("alt");
  if (event.shiftKey) mods.push("shift");
  if (event.metaKey) mods.push("super");
  return [...mods, key].join("+");
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = { ctrl: "⌃", alt: "⌥", shift: "⇧", super: "⌘" };
const OTHER_NAMES: Readonly<Record<string, string>> = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", super: "Super" };
const KEY_LABELS: Readonly<Record<string, string>> = {
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  page_up: "PgUp",
  page_down: "PgDn",
  enter: "Enter",
  tab: "Tab",
  escape: "Esc",
  backspace: "⌫",
  delete: "Del",
  insert: "Ins",
  home: "Home",
  end: "End",
  space: "Space",
};

/** The keys of a trigger as chips: "⌘", "⇧", "T" on macOS; "Ctrl", "Shift", "T" elsewhere. */
export function triggerKeys(trigger: string, platform: Platform): string[] {
  const parts =
    trigger === "+" ? ["+"] : trigger.endsWith("++") ? [...trigger.slice(0, -2).split("+"), "+"] : trigger.split("+");
  const key = parts.at(-1) ?? "";
  const names = platform === "mac" ? MAC_SYMBOLS : OTHER_NAMES;
  return [...parts.slice(0, -1).map((mod) => names[mod] ?? mod), KEY_LABELS[key] ?? key.toUpperCase()];
}

export function currentPlatform(): Platform {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return nav !== undefined && /mac|iphone|ipad/i.test(nav.platform || nav.userAgent) ? "mac" : "other";
}
