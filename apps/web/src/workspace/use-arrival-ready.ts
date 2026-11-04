import { useEffect } from "react";

/**
 * Turns arrival motion on (`data-ready` on the root) only after the workspace has painted with its terminals listed,
 * so the first screen is the real one rather than a fade-in. It stays on for the page's life: a remount after a
 * reconnect is not an arrival either.
 */
export function useArrivalReady(loaded: boolean): void {
  useEffect(() => {
    if (!loaded || document.documentElement.hasAttribute("data-ready")) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => document.documentElement.setAttribute("data-ready", ""));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [loaded]);
}
