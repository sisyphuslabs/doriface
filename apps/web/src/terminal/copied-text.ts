/**
 * What goes on the clipboard for a terminal selection. With `trim` (Ghostty's clipboard-trim-trailing-spaces, on by
 * default) each line loses the spaces and tabs after its last character, and the blank rows after the last text go.
 */
export function copiedText(selection: string, trim: boolean): string {
  if (!trim) return selection;
  return selection
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}
