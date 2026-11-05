import type { WTerm } from "@wterm/react";
import { sendBytes } from "../keys/actions.ts";
import { useActionHandler } from "../keys/dispatcher.ts";
import { scrollTerminal } from "./terminal-scroll.tsx";
import type { TerminalInput } from "./terminal-view.tsx";

/** `send` is the view's input path, so bound keys queue through a reconnect in order with typed input. */
export function useTerminalActions(wt: WTerm | null, send: (data: TerminalInput) => void, focused: boolean): void {
  useActionHandler("terminal", (action) => {
    if (wt === null || !focused) return false;
    if (action.startsWith("send:")) return (send(sendBytes(action)), true);
    switch (action) {
      case "terminal.copy": {
        const text = wt.getSelectionText();
        if (text === null || text === "") return false;
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        return true;
      }
      case "terminal.paste":
        // Not consumed: the browser's own paste event runs clipboard-paste-protection and works where
        // clipboard-read is denied (the desktop shell).
        return false;
      case "terminal.select_all":
        void wt.selectAll();
        return true;
      case "terminal.clear":
        send("\u000c");
        return true;
      case "terminal.scroll:top":
        return scrollTerminal(wt, { to: "top" });
      case "terminal.scroll:bottom":
        return scrollTerminal(wt, { to: "bottom" });
      case "terminal.scroll:page_up":
        return scrollTerminal(wt, { pages: -1 });
      case "terminal.scroll:page_down":
        return scrollTerminal(wt, { pages: 1 });
      case "terminal.scroll:line_up":
        return scrollTerminal(wt, { lines: -1 });
      case "terminal.scroll:line_down":
        return scrollTerminal(wt, { lines: 1 });
      case "terminal.prompt:prev":
        return wt.scrollToPrompt(-1);
      case "terminal.prompt:next":
        return wt.scrollToPrompt(1);
      default:
        return false;
    }
  });
}
