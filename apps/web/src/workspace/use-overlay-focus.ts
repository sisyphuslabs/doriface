import { useEffect, type RefObject } from "react";

const TAB_STOPS = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function isUsable(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    element !== document.body &&
    element.checkVisibility() &&
    !element.matches(":disabled") &&
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

function trapTab(overlay: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const stops = [...overlay.querySelectorAll(TAB_STOPS)].filter(
    (stop): stop is HTMLElement => isUsable(stop) && stop.tabIndex >= 0,
  );
  if (stops.length === 0) return;
  event.preventDefault();
  const at = stops.findIndex((stop) => stop === document.activeElement);
  const step = event.shiftKey ? -1 : 1;
  const next = at === -1 ? (step === 1 ? 0 : stops.length - 1) : (at + step + stops.length) % stops.length;
  stops[next]?.focus();
}

/**
 * While the overlay is mounted it owns the keyboard: focus starts on its `selector` element, Tab and
 * Shift+Tab cycle through its own tab stops (moving to the page body fires no focusin, so `keep`
 * alone cannot hold it), and anything that takes focus outside it (a terminal whose renderer focuses
 * itself as it starts) hands it straight back. Once it unmounts, focus left on the page body (it
 * closed under its own input) goes back through restoreTargets. After the New tab row that is first
 * the old terminal; the new one then takes focus itself when it becomes ready.
 */
export function useOverlayFocus(root: RefObject<HTMLElement | null>, selector: string): void {
  useEffect(() => {
    const opener = document.activeElement;
    const overlay = root.current;
    const target = (): HTMLElement | null => root.current?.querySelector<HTMLElement>(selector) ?? null;
    target()?.focus();
    const keep = (event: FocusEvent): void => {
      const current = root.current;
      if (current !== null && event.target instanceof Node && !current.contains(event.target)) target()?.focus();
    };
    const trap = (event: KeyboardEvent): void => {
      if (overlay !== null) trapTab(overlay, event);
    };
    document.addEventListener("focusin", keep);
    overlay?.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("focusin", keep);
      overlay?.removeEventListener("keydown", trap);
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      restoreTargets(opener).find(isUsable)?.focus();
    };
  }, [root, selector]);
}
