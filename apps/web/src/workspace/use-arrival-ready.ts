import { useEffect } from "react";

/**
 * Turns arrival motion on (`data-ready` on the root) only after the workspace has painted with its terminals listed,
 * and off again when the workspace unmounts, so neither the first screen nor a remount (a reconnect, coming back
 * from Settings) animates in: only regions gained while the workspace is on screen arrive.
 */
export function useArrivalReady(loaded: boolean): void {
  useEffect(() => {
    if (!loaded) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => document.documentElement.setAttribute("data-ready", ""));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [loaded]);
  useEffect(() => () => document.documentElement.removeAttribute("data-ready"), []);
}
