import { actionFor, actionFromGhostty } from "./actions.ts";
import { defaultKeymap, type Keymap } from "./defaults.ts";
import { normalizeTrigger, type Platform } from "./trigger.ts";

/** Only what the user changed: a trigger bound to an action, or null for a default the user removed. */
export type Overrides = ReadonlyMap<string, string | null>;

export const NO_OVERRIDES: Overrides = new Map();

export function resolveKeymap(platform: Platform, overrides: Overrides): Keymap {
  const map = new Map(defaultKeymap(platform));
  for (const [trigger, action] of overrides) {
    if (action === null) map.delete(trigger);
    else map.set(trigger, action);
  }
  return map;
}

export function triggersFor(keymap: Keymap, action: string): string[] {
  return [...keymap].filter(([, bound]) => bound === action).map(([trigger]) => trigger);
}

export type Checked = { readonly ok: true; readonly trigger: string } | { readonly ok: false; readonly reason: string };

/** A write is refused unless the trigger parses and the action exists; the normalized trigger is returned. */
export function checkBinding(trigger: string, action: string | null): Checked {
  const normalized = normalizeTrigger(trigger);
  if (normalized === null) return { ok: false, reason: `"${trigger}" is not a key combination` };
  if (action !== null && actionFor(action) === null) return { ok: false, reason: `"${action}" is not an action` };
  return { ok: true, trigger: normalized };
}

export function withBinding(platform: Platform, overrides: Overrides, trigger: string, action: string): Overrides {
  const next = new Map(overrides);
  const defaults = defaultKeymap(platform);
  if (defaults.get(trigger) === action) next.delete(trigger);
  else next.set(trigger, action);
  return next;
}

export function withoutTrigger(platform: Platform, overrides: Overrides, trigger: string): Overrides {
  const next = new Map(overrides);
  if (defaultKeymap(platform).has(trigger)) next.set(trigger, null);
  else next.delete(trigger);
  return next;
}

/** Forgets every override that touches the action, so its defaults come back. */
export function resetAction(platform: Platform, overrides: Overrides, action: string): Overrides {
  const defaults = defaultKeymap(platform);
  const next = new Map(overrides);
  for (const [trigger, bound] of overrides) {
    if (bound === action || (bound === null && defaults.get(trigger) === action)) next.delete(trigger);
  }
  return next;
}

export interface KeybindLine {
  readonly line: number;
  readonly text: string;
  readonly status: "applies" | "invalid" | "unknown";
  readonly reason?: string;
}

export interface ParsedKeybinds {
  readonly lines: readonly KeybindLine[];
  readonly overrides: Overrides;
}

/** `keybind = trigger=action` lines from a Ghostty config; `unbind` removes, `clear` resets everything. */
export function parseKeybinds(text: string): ParsedKeybinds {
  const lines: KeybindLine[] = [];
  const overrides = new Map<string, string | null>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    const match = /^keybind\s*=\s*(.*)$/.exec(trimmed);
    if (match === null) return;
    const body = (match[1] ?? "").trim().replace(/^"(.*)"$/, "$1");
    if (body === "clear") {
      overrides.clear();
      lines.push({ line, text: body, status: "applies" });
      return;
    }
    const eq = body.indexOf("=", body.startsWith("+") ? 1 : 0);
    const split = body.endsWith("+=") ? -1 : eq;
    const [trigger, ghostty] = split === -1 ? [body, ""] : [body.slice(0, split), body.slice(split + 1)];
    const action = actionFromGhostty(ghostty.trim());
    if (action === undefined) {
      lines.push({ line, text: body, status: "unknown", reason: `"${ghostty.trim()}" is not an action doriface has` });
      return;
    }
    const checked = checkBinding(trigger.replace(/^(global|all|unconsumed|performable):/, ""), action);
    if (!checked.ok) {
      lines.push({ line, text: body, status: "invalid", reason: checked.reason });
      return;
    }
    overrides.set(checked.trigger, action);
    lines.push({ line, text: body, status: "applies" });
  });
  return { lines, overrides };
}

export function serializeKeybinds(overrides: Overrides): string {
  const out = ["# Keybindings exported from doriface (Ghostty keybind syntax)"];
  for (const [trigger, action] of overrides) {
    const ghostty = action === null ? "unbind" : (actionFor(action)?.ghostty ?? action);
    out.push(`keybind = ${trigger}=${ghostty}`);
  }
  return `${out.join("\n")}\n`;
}
