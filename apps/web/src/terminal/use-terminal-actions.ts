import type { WTerm } from "@wterm/react";
import { terminalConfigStore } from "../ghostty/config-store.ts";
import { rendererOptions } from "../ghostty/render-options.ts";
import { sendBytes } from "../keys/actions.ts";
import { copiedText } from "./copied-text.ts";
import { useActionHandler } from "../keys/dispatcher.ts";
import { scrollTerminal } from "./terminal-scroll.tsx";
import type { TerminalInput } from "./terminal-view.tsx";

/** Select alls still being made, per terminal; Copy waits for its terminal's. */
const selectingAll = new WeakMap<WTerm, Promise<unknown>>();

/** Puts the terminal's selection on the clipboard, trimmed as the config says; false when nothing is selected. */
function copySelection(wt: WTerm): boolean {
  const text = wt.getSelectionText();
  if (text === null || text === "") return false;
  const { trimCopy } = rendererOptions(terminalConfigStore.config);
  void navigator.clipboard?.writeText(copiedText(text, trimCopy)).catch(() => undefined);
  return true;
}

/** `send` is the view's input path, so bound keys queue through a reconnect in order with typed input. */
export function useTerminalActions(wt: WTerm | null, send: (data: TerminalInput) => void, focused: boolean): void {
  useActionHandler("terminal", (action) => {
    if (wt === null || !focused) return false;
    if (action.startsWith("send:")) return (send(sendBytes(action)), true);
    switch (action) {
      case "terminal.copy": {
        // A Select all still being made is waited for, so Copy right after it copies what it selects.
        const selecting = selectingAll.get(wt);
        if (selecting !== undefined) {
          void selecting.then(() => copySelection(wt));
          return true;
        }
        return copySelection(wt);
      }
      case "terminal.paste":
        // Not consumed: the browser's own paste event runs clipboard-paste-protection and works where
        // clipboard-read is denied (the desktop shell).
        return false;
      case "terminal.select_all": {
        const selecting = Promise.resolve(wt.selectAll()).finally(() => {
          if (selectingAll.get(wt) === selecting) selectingAll.delete(wt);
        });
        selectingAll.set(wt, selecting);
        return true;
      }
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
