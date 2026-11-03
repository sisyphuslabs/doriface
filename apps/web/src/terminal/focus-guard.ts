/** Overlays that own the keyboard while open: the palette and every modal dialog. */
const OVERLAY = '[aria-modal="true"], [role="alertdialog"]';

export interface FocusState {
  readonly overlayOpen: boolean;
  /** Before the terminal mounted, focus sat on the page body (nothing focused) or already inside it. */
  readonly focusIsFree: boolean;
}

/** A terminal that becomes ready may keep focus only with no overlay open and focus not held elsewhere. */
export function mayTakeFocus({ overlayOpen, focusIsFree }: FocusState): boolean {
  return !overlayOpen && focusIsFree;
}

export function focusStateOf(doc: Document, own: Element, before: Element | null): FocusState {
  return {
    overlayOpen: doc.querySelector(OVERLAY) !== null,
    focusIsFree: before === null || before === doc.body || own.contains(before),
  };
}

/**
 * The renderer focuses its input while it starts, so a terminal that becomes ready under an open
 * overlay has already taken focus; this gives it back to what held it before.
 */
export function settleFocusOnReady(doc: Document, own: HTMLElement, before: Element | null, focus: () => void): void {
  if (mayTakeFocus(focusStateOf(doc, own, before))) return focus();
  if (before instanceof HTMLElement && before.isConnected && own.contains(doc.activeElement)) before.focus();
}
