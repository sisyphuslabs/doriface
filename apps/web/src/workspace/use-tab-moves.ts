import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";
import type { View } from "../layout/view.ts";
import { moveTabTo, type TabMove } from "./tab-order.ts";

/** Moving a tab in the strip: the order is this screen's own (`View.order`), and only a move that changes it is said. */
export function useTabMoves(
  tabs: readonly { readonly key: string }[],
  setView: Dispatch<SetStateAction<View>>,
): { readonly moveTab: (key: string, to: number) => void; readonly lastMove: TabMove | null } {
  const [lastMove, setLastMove] = useState<TabMove | null>(null);
  const shown = useRef(tabs);
  shown.current = tabs;
  const moveTab = useCallback(
    (key: string, to: number): void => {
      const keys = shown.current.map((tab) => tab.key);
      setLastMove((said) => moveTabTo(keys, said, key, to).said);
      setView((prev) => ({ ...prev, order: moveTabTo(keys, null, key, to).order }));
    },
    [setView],
  );
  return { moveTab, lastMove };
}
