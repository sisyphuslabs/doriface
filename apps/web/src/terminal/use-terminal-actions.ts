import type { TerminalStream } from "@doriface/client";
import type { WTerm } from "@wterm/react";
import type { RefObject } from "react";
import { useActionHandler } from "../keys/dispatcher.ts";

export function useTerminalActions(wt: WTerm | null, stream: RefObject<TerminalStream | null>, focused: boolean): void {
  useActionHandler("terminal", (action) => {
    if (wt === null || !focused) return false;
    if (action.startsWith("send:")) return (stream.current?.write(action.slice(5)), true);
    const view = wt.element;
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
        stream.current?.write("\u000c");
        return true;
      case "terminal.scroll:top":
        view.scrollTo({ top: 0 });
        return true;
      case "terminal.scroll:bottom":
        view.scrollTo({ top: view.scrollHeight });
        return true;
      case "terminal.scroll:page_up":
        view.scrollBy({ top: -view.clientHeight });
        return true;
      case "terminal.scroll:page_down":
        view.scrollBy({ top: view.clientHeight });
        return true;
      case "terminal.prompt:prev":
        return wt.scrollToPrompt(-1);
      case "terminal.prompt:next":
        return wt.scrollToPrompt(1);
      default:
        return false;
    }
  });
}
