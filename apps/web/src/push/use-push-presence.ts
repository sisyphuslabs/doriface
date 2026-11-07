import { use, useEffect } from "react";
import { ActionsPaused } from "../keys/dispatcher.ts";
import { desktopNotices } from "./desktop-notices.ts";
import { pushChannel } from "./push-channel.ts";

const seen = (): boolean => document.visibilityState === "visible" && document.hasFocus();

/**
 * Tells the host which pane this device shows while the page is visible and focused, so it sends no push about it; the
 * desktop app's own notifications hold back the same way. While Settings is up (ActionsPaused, router.tsx) no pane is
 * shown: the workspace stays mounted under it, inert, whether Settings is the phone's sheet over it or the dialog that
 * leaves it in view (#843), and a notice about a pane behind Settings must still come (#1024).
 */
export function usePushPresence(terminal: string | null): void {
  const covered = use(ActionsPaused);
  useEffect(() => {
    const report = (): void => {
      const shown = !covered && seen() ? terminal : null;
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
  }, [terminal, covered]);
}
