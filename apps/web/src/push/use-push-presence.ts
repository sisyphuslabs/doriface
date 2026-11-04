import { useEffect } from "react";
import { pushChannel } from "./push-channel.ts";

const seen = (): boolean => document.visibilityState === "visible" && document.hasFocus();

/** Tells the host which pane this device shows while the page is visible and focused, so it sends no push about it. */
export function usePushPresence(terminal: string | null): void {
  useEffect(() => {
    const report = (): void => pushChannel.focus(seen() ? terminal : null);
    report();
    document.addEventListener("visibilitychange", report);
    addEventListener("focus", report);
    addEventListener("blur", report);
    return () => {
      document.removeEventListener("visibilitychange", report);
      removeEventListener("focus", report);
      removeEventListener("blur", report);
      pushChannel.focus(null);
    };
  }, [terminal]);
}
