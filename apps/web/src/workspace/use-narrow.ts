import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767.98px)";

/** Below `md` the shell switches to the phone navigation (DESIGN.md section 4). */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = matchMedia(QUERY);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => matchMedia(QUERY).matches,
  );
}
