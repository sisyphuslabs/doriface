import { useSyncExternalStore } from "react";

const QUERY = "(prefers-color-scheme: dark)";

/** At module scope, so React keeps one subscription per terminal instead of renewing it on every render. */
function subscribe(listener: () => void): () => void {
  const media = matchMedia(QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

const isDark = (): boolean => matchMedia(QUERY).matches;

/** Whether the system asks for dark; it changes live, as when macOS turns dark at sunset with the app open. */
export function useDarkScheme(): boolean {
  return useSyncExternalStore(subscribe, isDark);
}
