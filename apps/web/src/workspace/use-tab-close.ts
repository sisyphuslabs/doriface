import { removeTab } from "@doriface/protocol/layout";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { View } from "../layout/view.ts";
import { afterClosing, findTerminal, type LayoutTab } from "./layout-model.ts";
import { type DropTarget, type Leaving, useDropPane } from "./use-drop-pane.ts";

export interface TabClose {
  /** Takes the terminal's pane out of its tab, and the tab when it was the last pane; the terminal is untouched. */
  readonly dropPane: (address: string) => void;
  readonly closeTab: (key: string) => void;
}

/**
 * Closing panes and tabs from this screen. A tab in view that closes leaves the last of the others in view, as the tab
 * strip did before the split tree, so the keyboard lands in a terminal that is left rather than in the first tab.
 */
export function useTabClose(
  tabs: readonly LayoutTab[],
  active: LayoutTab | null,
  layoutOf: (machine: string | null) => DropTarget | undefined,
  setLoose: Dispatch<SetStateAction<readonly string[]>>,
  setView: Dispatch<SetStateAction<View>>,
  /** Moves focus off a pane as its drop goes out, and returns how to undo that when the write fails. */
  leavePane: (leaving: Leaving) => () => void,
): TabClose {
  const leave = useCallback(
    (key: string): void => {
      if (active?.key === key) setView((prev) => ({ ...prev, active: afterClosing(tabs, key) }));
    },
    [active, setView, tabs],
  );

  const dropFromDoc = useDropPane(tabs, layoutOf, setLoose, leavePane);
  const dropPane = useCallback(
    (address: string): void => {
      const found = findTerminal(tabs, address);
      dropFromDoc(address);
      if (found?.tab.panes.length === 1) leave(found.tab.key);
    },
    [dropFromDoc, leave, tabs],
  );

  const closeTab = useCallback(
    (key: string): void => {
      const tab = tabs.find((each) => each.key === key);
      if (tab === undefined) return;
      leave(key);
      if (tab.transient) return setLoose((prev) => prev.filter((address) => address !== tab.panes[0]?.address));
      void layoutOf(tab.machine)?.edit((doc) => (doc === null ? null : removeTab(doc, tab.id)));
    },
    [layoutOf, leave, setLoose, tabs],
  );

  return { dropPane, closeTab };
}
