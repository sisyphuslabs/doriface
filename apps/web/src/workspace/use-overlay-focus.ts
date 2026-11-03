import { useCallback, useEffect, useRef, type RefObject } from "react";

function isUsable(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement && element.isConnected && element !== document.body && element.checkVisibility()
  );
}

/**
 * While the overlay is mounted it owns the keyboard: focus starts on its `selector` element, and
 * anything that takes focus outside it (a terminal whose renderer focuses itself as it starts)
 * hands it straight back. Returns `dismiss`: call it when the overlay is cancelled, and focus goes
 * to the active terminal once it unmounts, or else back to what opened it.
 */
export function useOverlayFocus(root: RefObject<HTMLElement | null>, selector: string): () => void {
  const dismissed = useRef(false);
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
      if (!dismissed.current) return;
      // The focused pane's terminal first, then any shown one (the phone), then what opened the overlay.
      const candidates = [
        document.querySelector('[data-focused="true"] [data-terminal] textarea'),
        ...document.querySelectorAll("[data-terminal] textarea"),
        opener,
      ];
      candidates.find(isUsable)?.focus();
    };
  }, [root, selector]);
  return useCallback(() => {
    dismissed.current = true;
  }, []);
}
