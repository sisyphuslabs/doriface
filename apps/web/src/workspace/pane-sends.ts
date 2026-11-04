import { useState } from "react";
import type { TerminalInput } from "../terminal/terminal-view.tsx";

type Send = (data: TerminalInput) => void;

export interface PaneSends {
  /** A pane's TerminalView onSend, the same function for the same address on every render. */
  readonly onSend: (address: string) => (send: Send | null) => void;
  /** Writes `text` as typed input into that pane's terminal; false when no view is attached for it. */
  readonly type: (address: string, text: string) => boolean;
}

/** The input path of every mounted pane, so input from outside a pane (dictation) reaches the right terminal. */
export function usePaneSends(): PaneSends {
  const [sends] = useState(() => {
    const live = new Map<string, Send>();
    const callbacks = new Map<string, (send: Send | null) => void>();
    const onSend = (address: string): ((send: Send | null) => void) => {
      const known = callbacks.get(address);
      if (known !== undefined) return known;
      const callback = (send: Send | null): void => {
        if (send === null) live.delete(address);
        else live.set(address, send);
      };
      callbacks.set(address, callback);
      return callback;
    };
    const type = (address: string, text: string): boolean => {
      const send = live.get(address);
      send?.(text);
      return send !== undefined;
    };
    return { onSend, type };
  });
  return sends;
}
