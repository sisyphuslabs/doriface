import type { Platform } from "./trigger.ts";

/** A herdr-app default that doriface's default keymap does not bind to the same action, and why. */
export interface HerdrDifference {
  /** herdr-app's spelling of the chord, as in its keys file. */
  readonly chord: string;
  /** What doriface's default keymap binds that trigger to; null when nothing. */
  readonly doriface: string | null;
  readonly reason: string;
}

const APP_MENU = "the desktop app's macOS app menu carries it (a standard menu role); a browser keeps it for itself";
const NO_HELP = "no shortcuts dialog yet (#733); Settings > Keybindings lists every key";
const NO_SEARCH = "no find bar in a terminal yet (#732)";
const NO_IMAGE_PASTE = "no image paste yet (#701); Ctrl+V reaches the terminal program, which reads it as ^V";
const NO_MODS = "doriface has no mods, so there is no picker mod to open";
const NO_LAYOUTS = "doriface has no layout files to switch between";

/**
 * Every herdr-app default (herdr-app/keys*.json) that doriface binds differently. `herdr-app-parity.test.ts` holds this
 * table to the vendored files and `defaults.ts` both ways, and `docs/keymap-herdr-app.md` is generated from it.
 */
export const HERDR_APP_DIFFERENCES: Readonly<Record<Platform, readonly HerdrDifference[]>> = {
  mac: [
    { chord: "cmd-q", doriface: null, reason: APP_MENU },
    { chord: "cmd-h", doriface: null, reason: APP_MENU },
    { chord: "cmd-alt-h", doriface: null, reason: APP_MENU },
    { chord: "cmd-shift-l", doriface: null, reason: NO_LAYOUTS },
    { chord: "cmd-p", doriface: null, reason: NO_MODS },
    { chord: "cmd-/", doriface: null, reason: NO_HELP },
    { chord: "cmd-shift-/", doriface: null, reason: NO_HELP },
    { chord: "cmd-f", doriface: null, reason: NO_SEARCH },
    { chord: "ctrl-v", doriface: null, reason: NO_IMAGE_PASTE },
  ],
  other: [
    { chord: "ctrl-?", doriface: null, reason: NO_HELP },
    { chord: "ctrl-shift-/", doriface: null, reason: NO_HELP },
    { chord: "ctrl-shift-?", doriface: null, reason: NO_HELP },
    { chord: "ctrl-shift-k", doriface: null, reason: NO_MODS },
    { chord: "ctrl-shift-l", doriface: null, reason: NO_LAYOUTS },
    { chord: "ctrl-shift-f", doriface: null, reason: NO_SEARCH },
    { chord: "ctrl-v", doriface: null, reason: NO_IMAGE_PASTE },
  ],
};

const numbered = (prefix: string, fallback: string): Record<string, string> =>
  Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`${prefix}${index + 1}`, fallback]));

/**
 * Chords herdr-app binds that a plain browser tab keeps for itself, so there only the installed app (PWA) and the
 * desktop app get them; the fallback is what does the same in a browser tab. Chromium reserves closing and opening tabs
 * and windows and cycling tabs (`kReservedCommandIds`), and lets a page take every other key, reload included.
 */
export const BROWSER_TAB_FALLBACK: Readonly<Record<Platform, Readonly<Record<string, string>>>> = {
  mac: {
    "cmd-t": "the tab bar's + button",
    "cmd-w": "Close tab on the tab, or Cmd+Alt+W",
    "cmd-shift-w": "the pane header's close button",
    "cmd-n": "New space in the tab bar's new menu",
    "cmd-shift-]": "click the tab",
    "cmd-shift-[": "click the tab",
    "ctrl-tab": "click the tab",
    "ctrl-shift-tab": "click the tab",
    ...numbered("cmd-", "click the tab"),
  },
  other: {
    "ctrl-shift-t": "the tab bar's + button",
    "ctrl-shift-w": "Close tab on the tab",
    "ctrl-shift-n": "New space in the tab bar's new menu",
    "ctrl-tab": "Alt+] or click the tab",
    "ctrl-shift-tab": "Alt+[ or click the tab",
    "ctrl-pagedown": "Alt+] or click the tab",
    "ctrl-pageup": "Alt+[ or click the tab",
    ...numbered("ctrl-", "click the tab"),
  },
};
