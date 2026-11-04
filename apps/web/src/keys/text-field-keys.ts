/**
 * App actions whose key a text field outside the terminal keeps: their chords edit text there (⌘⇧←/→ selects to the
 * line's start or end on a Mac), and DESIGN.md section 6 keeps standard shortcuts on their standard meaning.
 */
export const TEXT_FIELD_KEEPS: ReadonlySet<string> = new Set(["tab.move:left", "tab.move:right"]);
