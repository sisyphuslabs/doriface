/**
 * App actions a focused terminal program keeps: their key is not taken from the program, as a text field keeps the keys
 * that edit text (`text-field-keys.ts`). Ctrl and a digit is a control key a shell or a TUI reads (Ctrl is the terminal's
 * own modifier on every platform), so a space's number chord acts while the keyboard is outside the terminal (the
 * sidebar, the tab strip, the palette, the Shell menu) and reaches the program otherwise. Space's cycle chords keep a
 * modifier the app owns, so they work from a terminal too.
 */
export const TERMINAL_KEEPS: ReadonlySet<string> = new Set(
  Array.from({ length: 9 }, (_, index) => `space.select:${index + 1}`),
);
