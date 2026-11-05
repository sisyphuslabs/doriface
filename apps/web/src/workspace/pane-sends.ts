import { useState } from "react";
import type { TerminalPort } from "../terminal/terminal-port.ts";

export interface PaneSends {
  /** A pane's TerminalView onPort, the same function for the same address on every render. */
  readonly onPort: (address: string) => (port: TerminalPort | null) => void;
  /** Writes `text` as typed input into that pane's terminal; false when no view is attached for it. */
  readonly type: (address: string, text: string) => boolean;
}

/** The input path of every mounted pane, so input from outside a pane (dictation) reaches the right terminal. */
export function usePaneSends(): PaneSends {
  const [sends] = useState(() => {
    const live = new Map<string, TerminalPort>();
    const callbacks = new Map<string, (port: TerminalPort | null) => void>();
    const onPort = (address: string): ((port: TerminalPort | null) => void) => {
      const known = callbacks.get(address);
      if (known !== undefined) return known;
      const callback = (port: TerminalPort | null): void => {
        if (port === null) live.delete(address);
        else live.set(address, port);
      };
      callbacks.set(address, callback);
      return callback;
    };
    const type = (address: string, text: string): boolean => {
      const port = live.get(address);
      port?.send(text);
      return port !== undefined;
    };
    return { onPort, type };
  });
  return sends;
}
