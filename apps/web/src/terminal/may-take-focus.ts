/** What an open modal leaves behind it: a Base UI dialog or alert dialog marks the rest of the page aria-hidden. */
const BEHIND_MODAL = '[aria-hidden="true"], [inert]';
/**
 * Layers that hold the keyboard while open: dialogs and alert dialogs (the palette is a dialog too), and menus, which
 * Base UI opens without hiding the page.
 */
const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * Whether a terminal may move keyboard focus into itself on its own: as its renderer starts, its stream attaches, its
 * pane becomes the focused one, or a press that started on it ends.
 * Never while a modal is open over it: focus would leave the open question, Esc would no longer reach it, and keys
 * typed next would go to the program behind it.
 */
export function mayTakeFocus(terminal: HTMLElement): boolean {
  if (terminal.closest(BEHIND_MODAL) !== null) return false;
  const active = terminal.ownerDocument.activeElement;
  return active === null || terminal.contains(active) || active.closest(LAYERS) === null;
}
