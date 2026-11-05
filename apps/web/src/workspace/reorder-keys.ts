import type { Keymap } from "../keys/defaults.ts";
import { triggersFor } from "../keys/keymap.ts";
import { normalizeTrigger, type Platform, triggerFromEvent, triggerKeys } from "../keys/trigger.ts";

/**
 * The keys that move a row of a sidebar list: the chords bound to Move tab left/right (#123), so a rebound chord moves
 * the row too (#205), and on macOS Cmd+Shift+Up/Down as well, the list being vertical.
 */
const VERTICAL: Readonly<Record<Platform, { readonly earlier: readonly string[]; readonly later: readonly string[] }>> =
  {
    mac: { earlier: ["super+shift+up"], later: ["super+shift+down"] },
    other: { earlier: [], later: [] },
  };

/** In the keymap's canonical form (modifiers ordered ctrl, alt, shift, super), which is what a key event reads as. */
const canonical = (triggers: readonly string[]): readonly string[] =>
  triggers.flatMap((t) => normalizeTrigger(t) ?? []);

/** Each direction's chords as written: canonical for matching a key event, as they are for the menu's chips. */
const chords = (platform: Platform, keymap: Keymap) => ({
  earlier: [...VERTICAL[platform].earlier, ...triggersFor(keymap, "tab.move:left")],
  later: [...VERTICAL[platform].later, ...triggersFor(keymap, "tab.move:right")],
});

/** -1 moves the row up, 1 down; null when the key is not a move. */
export function reorderStep(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  platform: Platform,
  keymap: Keymap,
): -1 | 1 | null {
  const trigger = triggerFromEvent(event);
  if (trigger === null) return null;
  const { earlier, later } = chords(platform, keymap);
  if (canonical(earlier).includes(trigger)) return -1;
  if (canonical(later).includes(trigger)) return 1;
  return null;
}

/** The chips a row's menu shows beside Move up and Move down: each direction's first chord, none when unbound. */
export function reorderKeys(
  platform: Platform,
  keymap: Keymap,
): { readonly up: readonly string[] | undefined; readonly down: readonly string[] | undefined } {
  const { earlier, later } = chords(platform, keymap);
  const chip = (trigger: string | undefined) => (trigger === undefined ? undefined : triggerKeys(trigger, platform));
  return { up: chip(earlier[0]), down: chip(later[0]) };
}
