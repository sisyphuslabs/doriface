import { createContext, useContext } from "react";

/** What a person asked to do with a session: rename it, end it, or close its pane (which ends it too). */
export interface SessionAsk {
  readonly kind: "rename" | "end" | "close";
  readonly address: string;
}

export const SessionContext = createContext<(ask: SessionAsk) => void>(() => {});

export const useAskSession = (): ((ask: SessionAsk) => void) => useContext(SessionContext);
