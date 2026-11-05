import { removeTab, tabsOf } from "@doriface/protocol/layout";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { View } from "../layout/view.ts";
import { afterClosing, findTerminal, type LayoutTab } from "./layout-model.ts";
import { type DropTarget, type Leaving, useDropPane } from "./use-drop-pane.ts";

export interface TabClose {
  /** Takes the terminal's pane out of its tab, and the tab when it was the last pane; the terminal is untouched. */
  readonly dropPane: (address: string) => void;
  readonly closeTab: (key: string) => void;
}

const noUndo = (): void => undefined;

/**
 * Closing panes and tabs from this screen. A tab in view that closes leaves the last of the others in view, as the tab
 * strip did before the split tree, so the keyboard lands in a terminal that is left rather than in the first tab.
 * That switch is part of the close's edit: a write that fails puts the tab back, and the view with it.
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
  // Returns how to undo the switch: the closed tab comes back into view only while the tab it handed the view to is
  // still the one in view, so a tab the person chose since is kept.
  const leave = useCallback(
    (key: string): (() => void) => {
      if (active?.key !== key) return noUndo;
      const next = afterClosing(tabs, key);
      setView((prev) => ({ ...prev, active: next }));
      return () => setView((prev) => (prev.active === next ? { ...prev, active: key } : prev));
    },
    [active, setView, tabs],
  );

  // A tab's last pane takes the tab with it, so the tab leaves the view as that drop goes out, not before a deferred one
  // runs, and comes back with the pane when the write fails.
  const leaveWithTab = useCallback(
    (leaving: Leaving): (() => void) => {
      const undoPane = leavePane(leaving);
      const undoTab = leaving.tab.panes.length === 1 ? leave(leaving.tab.key) : noUndo;
      return () => {
        undoTab();
        undoPane();
      };
    },
    [leave, leavePane],
  );

  const dropFromDoc = useDropPane(tabs, layoutOf, setLoose, leaveWithTab);
  const dropPane = useCallback(
    (address: string): void => {
      const found = findTerminal(tabs, address);
      dropFromDoc(address);
      // A tab of this screen's own has no write to refuse: it leaves the view at once, as before.
      if (found?.tab.transient === true && found.tab.panes.length === 1) leave(found.tab.key);
    },
    [dropFromDoc, leave, tabs],
  );

  const closeTab = useCallback(
    (key: string): void => {
      const tab = tabs.find((each) => each.key === key);
      if (tab === undefined) return;
      const undo = leave(key);
      if (tab.transient) return setLoose((prev) => prev.filter((address) => address !== tab.panes[0]?.address));
      // Whether the edit found the tab already out of the document: nothing is written, and it stays gone.
      let gone = false;
      void layoutOf(tab.machine)
        ?.edit((doc) => {
          if (doc === null || !tabsOf(doc).some((each) => each.id === tab.id)) {
            gone = true;
            return null;
          }
          return removeTab(doc, tab.id);
        })
        .then((written) => {
          if (!written && !gone) undo();
          return written;
        });
    },
    [layoutOf, leave, setLoose, tabs],
  );

  return { dropPane, closeTab };
}
