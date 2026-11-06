import { createContext, useContext } from "react";

/** Closing spaces, for the sidebar: ask with the question that ends a space's tabs. */
export interface SpaceClosing {
  /** Opens the Close space question for space `id` (a `spaceKey`). */
  readonly ask: (id: string) => void;
}

const NOT_PROVIDED: SpaceClosing = { ask: () => undefined };

export const SpaceCloseContext = createContext<SpaceClosing>(NOT_PROVIDED);

export const useSpaceClosing = (): SpaceClosing => useContext(SpaceCloseContext);
