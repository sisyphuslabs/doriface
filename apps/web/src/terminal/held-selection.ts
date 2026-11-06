/**
 * A selection a press left in a terminal, held by the view instead of the document.
 *
 * A non-collapsed document selection over the terminal's rows tells the browser that the focused input is a
 * non-editable selection. The OS input method then never starts a composition, so each Hangul keystroke arrives as its
 * own jamo instead of a syllable (#592). The rows are painted from the held range (use-selection-cells.ts) and its text
 * is what copy puts on the clipboard (use-focus-after-select.ts), so the selection still looks and copies as it did.
 */
export interface HeldSelection {
  readonly range: Range;
  readonly text: string;
}

const held = new WeakMap<Element, HeldSelection>();
const watchers = new WeakMap<Element, Set<() => void>>();

/** Holds `range` for `element`, and tells whatever paints it that it changed. */
export function holdSelection(element: Element, range: Range): void {
  held.set(element, { range, text: range.toString() });
  notify(element);
}

/** What `element` holds, or null when it holds nothing. */
export function heldSelection(element: Element): HeldSelection | null {
  return held.get(element) ?? null;
}

/** Lets go of what `element` holds, if anything. */
export function releaseSelection(element: Element): void {
  if (held.delete(element)) notify(element);
}

/** Runs `paint` when what `element` holds changes; returns the unsubscribe. */
export function onHeldSelection(element: Element, paint: () => void): () => void {
  const forElement = watchers.get(element) ?? new Set<() => void>();
  forElement.add(paint);
  watchers.set(element, forElement);
  return () => {
    forElement.delete(paint);
    if (forElement.size === 0) watchers.delete(element);
  };
}

function notify(element: Element): void {
  for (const paint of watchers.get(element) ?? []) paint();
}
