import { useEffect, type RefObject } from "react";

/**
 * While the overlay is mounted it owns the keyboard: focus starts on its `selector` element, and
 * anything that takes focus outside it (a terminal whose renderer focuses itself as it starts)
 * hands it straight back.
 */
export function useOverlayFocus(root: RefObject<HTMLElement | null>, selector: string): void {
  useEffect(() => {
    const target = (): HTMLElement | null => root.current?.querySelector<HTMLElement>(selector) ?? null;
    target()?.focus();
    const keep = (event: FocusEvent): void => {
      const overlay = root.current;
      if (overlay !== null && event.target instanceof Node && !overlay.contains(event.target)) target()?.focus();
    };
    document.addEventListener("focusin", keep);
    return () => document.removeEventListener("focusin", keep);
  }, [root, selector]);
}
