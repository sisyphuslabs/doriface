import type { TerminalStream } from "@doriface/client";
import type { WTerm } from "@wterm/react";
import { useEffect, type RefObject } from "react";
import type { RendererOptions } from "../ghostty/render-options.ts";

export interface PendingPaste {
  readonly text: string;
}

/** copy-on-select, mouse-hide-while-typing and clipboard-paste-protection on one terminal element. */
export function useBehaviors(
  wt: WTerm | null,
  stream: RefObject<TerminalStream | null>,
  options: RendererOptions,
  onUnsafePaste: (paste: PendingPaste) => void,
): void {
  const { copyOnSelect, hideMouseWhileTyping, pasteProtection } = options;
  useEffect(() => {
    if (wt === null) return undefined;
    const element = wt.element;
    const abort = new AbortController();
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
      capture = false,
    ) => element.addEventListener(type, listener, { signal: abort.signal, capture });

    if (copyOnSelect) {
      on("mouseup", () => {
        const text = wt.getSelectionText();
        if (text !== null && text !== "") void navigator.clipboard?.writeText(text).catch(() => undefined);
      });
    }
    if (hideMouseWhileTyping) {
      on("keydown", () => element.classList.add("cursor-none"));
      on("mousemove", () => element.classList.remove("cursor-none"));
    }
    if (pasteProtection) {
      on(
        "paste",
        (event) => {
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const bracketed = wt.bridge?.bracketedPaste() ?? false;
          if (bracketed || !/[\r\n]/.test(text.replace(/[\r\n]+$/, ""))) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          onUnsafePaste({ text });
        },
        true,
      );
    }
    return () => {
      abort.abort();
      element.classList.remove("cursor-none");
    };
  }, [wt, stream, copyOnSelect, hideMouseWhileTyping, pasteProtection, onUnsafePaste]);
}
