/**
 * Shift-chords the OS or a browser already gives a meaning, in doriface's trigger syntax. A doriface-only binding must
 * avoid these as well as Ghostty's and herdr-app's defaults. Sources: Apple's "Mac keyboard shortcuts" support page,
 * Chrome's, Firefox's, Edge's and Safari's shortcut references, and the GTK/IBus input methods on Linux.
 */
export const PLATFORM_RESERVED: Readonly<Record<string, string>> = {
  "shift+super+s": "macOS Save As; Firefox and Edge screenshot",
  "ctrl+shift+s": "Firefox and Edge screenshot",
  "shift+super+3": "macOS screenshot",
  "shift+super+4": "macOS screenshot",
  "shift+super+5": "macOS screenshot",
  "shift+super+`": "macOS previous window",
  "shift+super+h": "Safari home page; Finder home",
  "ctrl+shift+h": "Firefox history",
  "shift+super+m": "Chrome profile menu; Firefox responsive design mode",
  "ctrl+shift+m": "Chrome profile menu; Firefox responsive design mode",
  "shift+super+r": "browser hard reload; Safari Reader",
  "ctrl+shift+r": "browser hard reload",
  "shift+super+y": "Firefox downloads",
  "ctrl+shift+y": "Firefox downloads; Edge collections",
  "ctrl+shift+u": "GTK/IBus Unicode input on Linux",
  "shift+super+\\": "Safari tab overview",
  "ctrl+shift+0": "Windows input language hotkey",
};
