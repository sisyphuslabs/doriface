import { createContext, useContext } from "react";

/** Pins or unpins a terminal: sets or clears its herdr.pinned label in hc, which every client then reads. */
export type PinTerminal = (address: string, pinned: boolean) => void;

export const PinContext = createContext<PinTerminal>(() => {});

export const usePin = (): PinTerminal => useContext(PinContext);
