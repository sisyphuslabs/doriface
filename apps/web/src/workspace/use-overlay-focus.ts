import { useEffect, type RefObject } from "react";

function isUsable(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    element !== document.body &&
    element.checkVisibility() &&
    // Never into a subtree a modal has hidden or made inert: keys typed there would go behind it.
    element.closest('[aria-hidden="true"], [inert]') === null
  );
}

/**
 * Where focus goes back, first usable wins: the focused pane's terminal, any shown terminal, then
 * the opener. A modal still open behind the overlay (the paste dialog) has hidden the terminals, so
 * isUsable skips them and focus returns to the opener inside that dialog.
 */
function restoreTargets(opener: Element | null): (Element | null)[] {
  return [
    document.querySelector('[data-focused="true"] [data-terminal] textarea'),
    ...document.querySelectorAll("[data-terminal] textarea"),
    opener,
  ];
}

/**
 * While the overlay is mounted it owns the keyboard: focus starts on its `selector` element, and
 * anything that takes focus outside it (a terminal whose renderer focuses itself as it starts)
 * hands it straight back. Once it unmounts, focus left on the page body (it closed under its own
 * input) goes back: see restoreTargets. A row that opened a terminal has already moved focus there.
 */
export function useOverlayFocus(root: RefObject<HTMLElement | null>, selector: string): void {
  useEffect(() => {
    const opener = document.activeElement;
    const target = (): HTMLElement | null => root.current?.querySelector<HTMLElement>(selector) ?? null;
    target()?.focus();
    const keep = (event: FocusEvent): void => {
      const overlay = root.current;
      if (overlay !== null && event.target instanceof Node && !overlay.contains(event.target)) target()?.focus();
    };
    document.addEventListener("focusin", keep);
    return () => {
      document.removeEventListener("focusin", keep);
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      restoreTargets(opener).find(isUsable)?.focus();
    };
  }, [root, selector]);
}
