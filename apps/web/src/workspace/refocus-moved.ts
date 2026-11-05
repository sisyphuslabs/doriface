/**
 * Puts focus back on a moved row's button when the move dropped it: per the HTML focus fixup a focused node that is
 * removed and inserted again loses focus, and whether a reorder moves the focused row itself differs by engine and
 * reorder. Focus that went anywhere else since is left there. Returns whether it refocused.
 */
export function refocusMoved(
  button: { focus(): void } | undefined,
  active: Element | null,
  body: Element | null,
): boolean {
  if (button === undefined || (active !== null && active !== body)) return false;
  button.focus();
  return true;
}
