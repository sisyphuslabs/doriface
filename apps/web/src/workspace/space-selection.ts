import { createContext, use } from "react";
import type { ListedSpace } from "./model.ts";

/** The spaces of the layout documents, the one selected (the tab in view's `spaceKey`), and how to select another. */
export interface SpaceSelection {
  readonly spaces: readonly ListedSpace[];
  readonly selected: string | null;
  readonly select: (key: string) => void;
}

export const SpaceSelectionContext = createContext<SpaceSelection>({ spaces: [], selected: null, select: () => {} });

export const useSpaceSelection = (): SpaceSelection => use(SpaceSelectionContext);
