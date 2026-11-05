import { useEffect } from "react";
import { desktopNotices } from "./desktop-notices.ts";
import { pushChannel } from "./push-channel.ts";

const seen = (): boolean => document.visibilityState === "visible" && document.hasFocus();

/**
 * Tells the host which pane this device shows while the page is visible and focused, so it sends no push about it; the
 * desktop app's own notifications hold back the same way.
 */
export function usePushPresence(terminal: string | null): void {
  useEffect(() => {
    const report = (): void => {
      const shown = seen() ? terminal : null;
      pushChannel.focus(shown);
      desktopNotices?.focus(shown);
    };
    report();
    document.addEventListener("visibilitychange", report);
    addEventListener("focus", report);
    addEventListener("blur", report);
    return () => {
      document.removeEventListener("visibilitychange", report);
      removeEventListener("focus", report);
      removeEventListener("blur", report);
      pushChannel.focus(null);
      desktopNotices?.focus(null);
    };
  }, [terminal]);
}
