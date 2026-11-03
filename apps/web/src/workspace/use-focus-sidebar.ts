import { useEffect, useRef } from "react";
import { sidebarElement, sidebarStop, terminalInput } from "./focus-targets.ts";

/**
 * The way out of a focused terminal without the mouse: from the terminal (or anywhere else) it moves focus to the
 * sidebar's list, showing the sidebar first when it is hidden; from the sidebar it goes back to the terminal.
 */
export function useFocusSidebar(shown: boolean, show: () => void): () => void {
  const pending = useRef(false);
  useEffect(() => {
    if (!shown || !pending.current) return;
    pending.current = false;
    sidebarStop()?.focus();
  }, [shown]);
  return () => {
    if (sidebarElement()?.contains(document.activeElement) === true) {
      terminalInput()?.focus();
      return;
    }
    if (shown) {
      sidebarStop()?.focus();
      return;
    }
    pending.current = true;
    show();
  };
}
