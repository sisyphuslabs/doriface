import type { JsonObject } from "@doriface/protocol";
import { editTab, panesOf, pathTo, removePane, removeTab, tabsOf } from "@doriface/protocol/layout";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import { findTerminal, type LayoutPane, type LayoutTab } from "./layout-model.ts";

/** One machine's layout as a drop needs it: whether it takes edits now, and the edit. */
export interface DropTarget {
  readonly readOnly: string | null;
  readonly edit: (change: (doc: JsonObject | null) => JsonObject | null) => Promise<boolean>;
}

/**
 * Of the drops waiting for their machine's layout (`pending`), the ones whose layout takes edits now, and the ones whose
 * terminal no tab shows any more (nothing left to drop).
 */
export function writableDrops(
  pending: readonly string[],
  tabs: readonly LayoutTab[],
  writable: (machine: string | null) => boolean,
): { readonly now: readonly string[]; readonly gone: readonly string[] } {
  const now: string[] = [];
  const gone: string[] = [];
  for (const address of pending) {
    const found = findTerminal(tabs, address);
    if (found === null) gone.push(address);
    else if (writable(found.tab.machine)) now.push(address);
  }
  return { now, gone };
}

/** The pane a drop takes out, in the tab it was found in. */
export interface Leaving {
  readonly tab: LayoutTab;
  readonly pane: LayoutPane;
}

/**
 * Takes the terminal's pane out of its tab, and the tab when it was the last pane. A machine whose layout takes no
 * edits yet (still loading after a reconnect, or not connected) gets the drop as soon as it does, so a program that
 * ended while the line was down still closes its pane once the page is back.
 *
 * `leave` runs as the edit goes out, when the document already shows the pane gone, and returns how to undo what it
 * did: a write that fails puts the pane back, so the undo runs then, and the failure is reported by `edit`.
 */
export function useDropPane(
  tabs: readonly LayoutTab[],
  layoutOf: (machine: string | null) => DropTarget | undefined,
  setLoose: Dispatch<SetStateAction<readonly string[]>>,
  leave: (leaving: Leaving) => () => void,
): (address: string) => void {
  const [pending, setPending] = useState<readonly string[]>([]);
  const dropPane = useCallback(
    (address: string): void => {
      const found = findTerminal(tabs, address);
      if (found === null) return;
      if (found.tab.transient) return setLoose((prev) => prev.filter((each) => each !== address));
      const layout = layoutOf(found.tab.machine);
      if (layout === undefined || layout.readOnly !== null) {
        return setPending((prev) => (prev.includes(address) ? prev : [...prev, address]));
      }
      // Whether the edit found the pane already out of the document: nothing is written, and it stays gone.
      let gone = false;
      const undo = leave(found);
      void layout
        .edit((doc) => {
          const tab = doc === null ? undefined : tabsOf(doc).find((each) => each.id === found.tab.id);
          if (doc === null || tab === undefined || pathTo(tab.root, found.pane.id) === null) {
            gone = true;
            return null;
          }
          // A tab's only pane is its root: removing it leaves no tree at all, so the tab goes with it (#354).
          const root = removePane(tab.root, found.pane.id);
          return root === null || panesOf(root).length === 0
            ? removeTab(doc, found.tab.id)
            : editTab(doc, found.tab.id, () => root);
        })
        .then((written) => {
          if (!written && !gone) undo();
          return written;
        });
    },
    [layoutOf, leave, setLoose, tabs],
  );
  useEffect(() => {
    if (pending.length === 0) return;
    const { now, gone } = writableDrops(pending, tabs, (machine) => layoutOf(machine)?.readOnly === null);
    if (now.length + gone.length === 0) return;
    setPending((prev) => prev.filter((address) => !now.includes(address) && !gone.includes(address)));
    for (const address of now) dropPane(address);
  }, [dropPane, layoutOf, pending, tabs]);
  return dropPane;
}
