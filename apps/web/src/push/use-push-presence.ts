import { useEffect } from "react";
import { desktopNotices } from "./desktop-notices.ts";
import { pushChannel } from "./push-channel.ts";

/**
 * Whether the pane in view is really on screen. The page being visible is not enough: Settings keeps the workspace
 * mounted and hides it (`visibility: hidden` + `inert`), so a pane the workspace still calls focused is under the
 * Settings sheet — reporting it as shown made the desktop drop the notifications about it.
 */
const onScreen = (): boolean => {
  const focused = document.querySelector('[data-focused="true"]');
  return focused === null || getComputedStyle(focused).visibility !== "hidden";
};

const seen = (): boolean => document.visibilityState === "visible" && document.hasFocus() && onScreen();

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
