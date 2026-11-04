import { useSyncExternalStore } from "react";

const QUERY = "(prefers-color-scheme: dark)";

/** Whether the system asks for dark; it changes live, as when macOS turns dark at sunset with the app open. */
export function useDarkScheme(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = matchMedia(QUERY);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => matchMedia(QUERY).matches,
  );
}
