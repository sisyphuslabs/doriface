import { normalizeTrigger, type Platform } from "./trigger.ts";

export type Keymap = ReadonlyMap<string, string>;

const digits = (prefix: string, action: string): [string, string][] =>
  Array.from({ length: 9 }, (_, index) => [`${prefix}${index + 1}`, `${action}:${index + 1}`]);

/**
 * herdr-app's keys.macos.json merged with Ghostty's macOS defaults. Where the two disagree
 * herdr-app wins and Ghostty's trigger is added as an alias when it is free; the PR body lists each.
 */
const MAC: readonly [string, string][] = [
  ["super+t", "tab.new"],
  ["super+w", "tab.close"],
  ["ctrl+tab", "tab.next"],
  ["ctrl+shift+tab", "tab.prev"],
  ["super+shift+]", "tab.next"],
  ["super+shift+[", "tab.prev"],
  ["super+alt+right", "tab.next"],
  ["super+alt+left", "tab.prev"],
  ...digits("super+", "tab.select"),
  ["super+d", "pane.split"],
  ["super+shift+w", "pane.close"],
  ["super+alt+shift+left", "pane.go:left"],
  ["super+alt+shift+right", "pane.go:right"],
  ["super+]", "agent.next"],
  ["super+[", "agent.prev"],
  ["super+b", "layout.toggle:sidebar"],
  ["super+shift+.", "layout.focus:sidebar"],
  ["super+shift+p", "app.palette"],
  ["super+,", "app.settings"],
  ["super+=", "app.zoom_in"],
  ["super+shift+=", "app.zoom_in"],
  ["super+-", "app.zoom_out"],
  ["super+0", "app.zoom_reset"],
  ["super+c", "terminal.copy"],
  ["super+v", "terminal.paste"],
  ["super+a", "terminal.select_all"],
  ["super+k", "terminal.clear"],
  ["super+home", "terminal.scroll:top"],
  ["super+end", "terminal.scroll:bottom"],
  ["super+page_up", "terminal.scroll:page_up"],
  ["super+page_down", "terminal.scroll:page_down"],
  ["super+up", "terminal.prompt:prev"],
  ["super+down", "terminal.prompt:next"],
  ["alt+left", "send:\u001bb"],
  ["alt+right", "send:\u001bf"],
  ["alt+backspace", "send:\u0017"],
  ["super+left", "send:\u0001"],
  ["super+right", "send:\u0005"],
  ["super+backspace", "send:\u0015"],
];

/** herdr-app's keys.json merged with Ghostty's Linux and Windows defaults. */
const OTHER: readonly [string, string][] = [
  ["ctrl+shift+t", "tab.new"],
  ["ctrl+shift+w", "tab.close"],
  ["ctrl+tab", "tab.next"],
  ["ctrl+shift+tab", "tab.prev"],
  ["ctrl+page_down", "tab.next"],
  ["ctrl+page_up", "tab.prev"],
  ["alt+]", "tab.next"],
  ["alt+[", "tab.prev"],
  ...digits("ctrl+", "tab.select"),
  ...digits("alt+", "tab.select"),
  ["ctrl+shift+o", "pane.split"],
  ["ctrl+shift+x", "pane.close"],
  ["alt+h", "pane.go:left"],
  ["alt+l", "pane.go:right"],
  ["alt+left", "pane.go:left"],
  ["alt+right", "pane.go:right"],
  ["alt+down", "agent.next"],
  ["alt+up", "agent.prev"],
  ["ctrl+shift+b", "layout.toggle:sidebar"],
  ["ctrl+shift+.", "layout.focus:sidebar"],
  ["ctrl+shift+p", "app.palette"],
  ["ctrl+,", "app.settings"],
  ["ctrl+=", "app.zoom_in"],
  ["ctrl+shift+=", "app.zoom_in"],
  ["ctrl+-", "app.zoom_out"],
  ["ctrl+0", "app.zoom_reset"],
  ["ctrl+shift+c", "terminal.copy"],
  ["ctrl+insert", "terminal.copy"],
  ["ctrl+shift+v", "terminal.paste"],
  ["shift+insert", "terminal.paste"],
  ["ctrl+shift+a", "terminal.select_all"],
  ["shift+home", "terminal.scroll:top"],
  ["shift+end", "terminal.scroll:bottom"],
  ["shift+page_up", "terminal.scroll:page_up"],
  ["shift+page_down", "terminal.scroll:page_down"],
  ["ctrl+shift+up", "terminal.prompt:prev"],
  ["ctrl+shift+down", "terminal.prompt:next"],
  ["ctrl+backspace", "send:\u0017"],
  ["ctrl+left", "send:\u001bb"],
  ["ctrl+right", "send:\u001bf"],
];

function keymap(entries: readonly [string, string][]): Keymap {
  const map = new Map<string, string>();
  for (const [trigger, action] of entries) {
    const normalized = normalizeTrigger(trigger);
    if (normalized === null) throw new Error(`default trigger is not a trigger: ${trigger}`);
    map.set(normalized, action);
  }
  return map;
}

const DEFAULTS: Readonly<Record<Platform, Keymap>> = { mac: keymap(MAC), other: keymap(OTHER) };

export function defaultKeymap(platform: Platform): Keymap {
  return DEFAULTS[platform];
}
