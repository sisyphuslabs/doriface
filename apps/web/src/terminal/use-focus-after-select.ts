import type { WTerm } from "@wterm/react";
import { useEffect } from "react";
import { mayTakeFocus } from "./may-take-focus.ts";

/**
 * Dragging across the rows selects their text natively, and the browser moves focus to the page body
 * on the way, so keys typed next went nowhere. When a press that started here ends (wherever the
 * pointer is by then) with focus outside the terminal, focus goes back to its input and the selection
 * is put back, since focusing a textarea collapses the document selection into it. A modal that opened meanwhile (a
 * question asked from the keyboard while the button was down) keeps the keyboard.
 *
 * A double or triple click selects a word or line in wterm's own click handler, after that mouseup, and wterm blurs its
 * input as it does: the same restore runs again on that click (#516). wterm's handler was added first, so it has run.
 */
export function useFocusAfterSelect(wt: WTerm | null): void {
  useEffect(() => {
    if (wt === null) return undefined;
    const element = wt.element;
    const restore = (): void => {
      if (element.contains(document.activeElement) || !element.isConnected || !mayTakeFocus(element)) return;
      const selection = document.getSelection();
      const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
      wt.focus();
      if (selection === null || range === null || range.collapsed) return;
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const press = (event: MouseEvent): void => {
      if (event.button === 0) document.addEventListener("mouseup", restore, { once: true });
    };
    const multiClick = (event: MouseEvent): void => {
      if (event.button === 0 && event.detail >= 2) restore();
    };
    element.addEventListener("mousedown", press);
    element.addEventListener("click", multiClick);
    return () => {
      element.removeEventListener("mousedown", press);
      element.removeEventListener("click", multiClick);
      document.removeEventListener("mouseup", restore);
    };
  }, [wt]);
}
