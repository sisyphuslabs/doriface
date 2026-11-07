import { useContext, useEffect } from "react";
import { ActionsPaused } from "../keys/dispatcher.ts";
import { desktopNotices } from "./desktop-notices.ts";
import { pushChannel } from "./push-channel.ts";

const seen = (): boolean => document.visibilityState === "visible" && document.hasFocus();

/**
 * Tells the host which pane this device shows while the page is visible and focused, so it sends no push about it; the
 * desktop app's own notifications hold back the same way. Under Settings no pane counts as shown: the workspace stays
 * mounted there, as a full-screen sheet's hidden layer or behind the dialog, where it still draws but is inert, and a
 * pane the workspace still calls focused is not one anyone is watching (#993).
 */
export function usePushPresence(terminal: string | null): void {
  const underSettings = useContext(ActionsPaused);
  const inView = underSettings ? null : terminal;
  useEffect(() => {
    const report = (): void => {
      const shown = seen() ? inView : null;
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
  }, [inView]);
}
