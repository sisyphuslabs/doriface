export type CopyOutcome = "copied" | "selected";

/**
 * Puts the text on the clipboard. When the clipboard is missing (an insecure origin) or refuses, `select` selects the
 * text on screen instead, so a long press or Ctrl+C still gets it.
 */
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
  select: () => void,
): Promise<CopyOutcome> {
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text);
      return "copied";
    } catch {
      // Refused: fall through to selecting the text.
    }
  }
  select();
  return "selected";
}
