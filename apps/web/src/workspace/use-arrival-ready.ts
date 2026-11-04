import { useEffect } from "react";

/**
 * Whether the workspace shows the screen it has loaded: the terminals are listed, every kept tab shows (a tab on an added
 * machine waits for machine.list) and, with live terminals but no tab yet, the default tab that opens one render after
 * the list has opened. Until then a region mounting is part of that screen, not an arrival.
 */
export function workspaceSettled(
  loaded: boolean,
  tabs: { readonly open: readonly string[]; readonly restored: boolean },
  live: number,
): boolean {
  return loaded && tabs.restored && (tabs.open.length > 0 || live === 0);
}

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
