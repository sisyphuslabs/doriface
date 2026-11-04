import type { JsonObject, Terminal } from "@doriface/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTab as addDocTab,
  type Axis,
  type DocEdit,
  editTab,
  freshId,
  type Node,
  splitPane,
  tabsOf,
  terminalBlock,
} from "@doriface/protocol/layout";
import { nearest, type Direction } from "../layout/neighbor.ts";
import { arrange } from "../layout/rects.ts";
import { loadView, saveView, tabKey, type View } from "../layout/view.ts";
import {
  buildTabs,
  findTerminal,
  keepTransient,
  localOf,
  looseKey,
  pick,
  TRANSIENT,
  type LayoutPane,
  type LayoutTab,
} from "./layout-model.ts";
import { machineOf } from "./model.ts";
import { splitLanding } from "./split-landing.ts";
import { moveTabTo, orderTabs, type TabMove } from "./tab-order.ts";
import { useTabClose } from "./use-tab-close.ts";
import { LAYOUT_LOADING, type MachineLayout } from "./use-layout-docs.ts";

export interface Layout {
  readonly tabs: readonly LayoutTab[];
  readonly active: LayoutTab | null;
  readonly focused: LayoutPane | null;
  readonly zoomed: string | null;
  readonly selectTab: (key: string) => void;
  readonly focusPane: (tab: string, pane: string) => void;
  /** Focuses the pane that shows the terminal, or opens it in a new tab. */
  readonly openTerminal: (address: string) => void;
  /** Puts a terminal started for the focused pane beside it, and focuses it. */
  readonly split: (axis: Axis, address: string) => void;
  /** Takes the terminal's pane out of its tab, and the tab when it was the last pane; the terminal is untouched. */
  readonly dropPane: (address: string) => void;
  readonly closeTab: (key: string) => void;
  /** Focuses the nearest pane that way in the tab in view; false when none lies that way, so the key stays the program's. */
  readonly go: (direction: Direction) => boolean;
  /** Moves a tab so it ends at index `to` of `tabs`; panes and focus stay as they are. */
  readonly moveTab: (key: string, to: number) => void;
  /** The last tab moved, counted so the strip can say where it went each time, even to the same place twice. */
  readonly lastMove: TabMove | null;
  /**
   * machine.list has answered and every machine's layout has been read, or cannot be: the tabs on screen are all the
   * documents hold, so a tab showing up now is an arrival, not the restored screen.
   */
  readonly restored: boolean;
}

/** Proportions are all moving focus needs, so it measures the tree in a fixed box. */
const MEASURE = { x: 0, y: 0, width: 1600, height: 1000 } as const;

const rootOf = (id: string, children: readonly Node[]): Node => ({ children: [...children], id, type: "row" });

/** The transient tab's terminal as a tab for the document, with fresh ids. */
function written(tab: LayoutTab): { id: string; pane: string; root: Node } {
  const id = freshId("tb");
  const pane = freshId("p");
  const address = tab.panes[0]?.address ?? "";
  return { id, pane, root: rootOf(id, [terminalBlock(pane, localOf(address))]) };
}

export function useLayout(
  core: string,
  layouts: readonly MachineLayout[],
  terminals: readonly Terminal[],
  failed: (message: string) => void,
  told: (message: string) => void,
  /** This screen's tab order and focus could not be saved for the next reload; said once until a save works again. */
  unsaved: (message: string) => void,
  /** machine.list has answered since the workspace mounted, so every added machine's layout is known. */
  machinesListed = true,
): Layout {
  const [view, setView] = useState<View>(() => loadView(core));
  // Read through a ref: the toast it raises re-renders the workspace, which must not count as another write.
  const tellUnsaved = useRef(unsaved);
  tellUnsaved.current = unsaved;
  const refused = useRef(false);
  useEffect(() => {
    const reason = saveView(core, view);
    if (reason === null) {
      refused.current = false;
    } else if (!refused.current) {
      refused.current = true;
      tellUnsaved.current(reason);
    }
  }, [core, view]);
  // Terminals opened while their machine's layout took no edits; this screen shows them as tabs of its own.
  const [loose, setLoose] = useState<readonly string[]>([]);
  const tabs = useMemo(
    () => orderTabs(buildTabs(layouts, terminals, loose), view.order),
    [layouts, terminals, loose, view.order],
  );
  const { active, focused, zoomed } = pick(tabs, view);
  const layoutOf = useCallback(
    (machine: string | null) => {
      const layout = layouts.find((each) => each.machine === machine);
      if (layout === undefined) return undefined;
      const edit = (change: DocEdit): Promise<boolean> =>
        layout.edit(change).catch((cause: unknown) => {
          failed(cause instanceof Error ? cause.message : String(cause));
          return false;
        });
      return { ...layout, edit };
    },
    [failed, layouts],
  );

  const show = useCallback((key: string, pane: string | null): void => {
    setView((prev) => ({
      ...prev,
      active: key,
      focused: pane === null ? prev.focused : { ...prev.focused, [key]: pane },
    }));
  }, []);

  /** A tab of this screen's own for a terminal its machine's layout could not take. */
  const keepHere = useCallback(
    (address: string): void => {
      setLoose((prev) => (prev.includes(address) ? prev : [...prev, address]));
      show(looseKey(address), TRANSIENT);
    },
    [show],
  );

  /** The first live terminal shown alone, written to its own machine's layout, or kept on this screen when it takes none. */
  const keepApart = useCallback(
    (tab: LayoutTab): void => {
      const own = layoutOf(tab.machine);
      const address = tab.panes[0]?.address ?? "";
      if (own === undefined || own.readOnly !== null) {
        return setLoose((prev) => (prev.includes(address) ? prev : [...prev, address]));
      }
      const kept = written(tab);
      void own.edit((doc) =>
        addDocTab(doc, { id: spaceOf(doc) ?? freshId("spc"), folder: "" }, { id: kept.id, name: "", root: kept.root }),
      );
    },
    [layoutOf],
  );

  const addTab = useCallback(
    (address: string): void => {
      const machine = machineOf(address) ?? null;
      const layout = layoutOf(machine);
      const writable = layout !== undefined && layout.readOnly === null;
      const fate = keepTransient(active, address, writable);
      if (fate === "apart" && active !== null) keepApart(active);
      if (layout === undefined || layout.readOnly !== null) return keepHere(address);
      const id = freshId("tb");
      const pane = freshId("p");
      const tab: JsonObject = { id, name: "", root: rootOf(id, [terminalBlock(pane, localOf(address))]) };
      const kept = fate === "with-new" && active !== null ? written(active) : null;
      const near = active !== null && !active.transient && active.machine === machine ? active.space : null;
      void layout.edit((doc) => {
        const space = { id: near ?? spaceOf(doc) ?? freshId("spc"), folder: "" };
        const first = kept === null ? doc : addDocTab(doc, space, { id: kept.id, name: "", root: kept.root });
        return addDocTab(first, space, tab);
      });
      show(tabKey(layout.machineId, id), pane);
    },
    [active, keepApart, keepHere, layoutOf, show],
  );

  const openTerminal = useCallback(
    (address: string): void => {
      const found = findTerminal(tabs, address);
      if (found === null) addTab(address);
      else show(found.tab.key, found.pane.id);
    },
    [addTab, show, tabs],
  );

  const split = useCallback(
    (axis: Axis, address: string): void => {
      if (active === null || focused === null) return addTab(address);
      const layout = layoutOf(active.machine);
      if (layout === undefined || layout.readOnly !== null) return undefined;
      const pane = freshId("p");
      const block = terminalBlock(pane, localOf(address));
      if (active.transient) {
        const tab = written(active);
        const root = splitPane(tab.root, tab.pane, axis, block, freshId("s"));
        if (root === null) return undefined;
        void layout.edit((doc) =>
          addDocTab(doc, { id: spaceOf(doc) ?? freshId("spc"), folder: "" }, { id: tab.id, name: "", root }),
        );
        return show(tabKey(layout.machineId, tab.id), pane);
      }
      const container = freshId("s");
      // Whether the edit last found the pane gone; a write that failed instead was already reported by `edit`.
      let gone = false;
      void layout
        .edit((doc) => {
          const next =
            doc === null
              ? null
              : editTab(doc, active.id, (root) => splitPane(root, focused.id, axis, block, container));
          gone = next === null;
          return next;
        })
        .then((placed) => {
          const landing = splitLanding(placed, gone);
          if (landing === "own-tab") {
            addTab(address);
            told("The pane you split had closed, so the new terminal opened in a new tab.");
          }
          if (landing === "here") keepHere(address);
          return placed;
        });
      return show(active.key, pane);
    },
    [active, addTab, focused, keepHere, layoutOf, show, told],
  );

  const { dropPane, closeTab } = useTabClose(tabs, active, layoutOf, setLoose, setView);

  const selectTab = useCallback((key: string): void => show(key, null), [show]);
  const focusPane = useCallback((tab: string, pane: string): void => show(tab, pane), [show]);
  const go = useCallback(
    (direction: Direction): boolean => {
      if (active === null || focused === null || active.panes.length < 2) return false;
      const to = nearest(focused.id, direction, arrange(active.root, MEASURE, 8, null).panes);
      if (to === null) return false;
      show(active.key, to);
      return true;
    },
    [active, focused, show],
  );

  const [lastMove, setLastMove] = useState<TabMove | null>(null);
  const shown = useRef(tabs);
  shown.current = tabs;
  const moveTab = useCallback((key: string, to: number): void => {
    const keys = shown.current.map((tab) => tab.key);
    // Only a move that changes the order is said: `moveTabTo` hands back the same `said` for one that does not.
    setLastMove((said) => moveTabTo(keys, said, key, to).said);
    setView((prev) => ({ ...prev, order: moveTabTo(keys, null, key, to).order }));
  }, []);

  return {
    tabs,
    active,
    focused,
    zoomed,
    selectTab,
    focusPane,
    openTerminal,
    split,
    dropPane,
    closeTab,
    go,
    moveTab,
    lastMove,
    restored: machinesListed && layouts.every((layout) => layout.loaded || layout.readOnly !== LAYOUT_LOADING),
  };
}

function spaceOf(doc: JsonObject | null): string | null {
  return doc === null ? null : (tabsOf(doc)[0]?.space ?? null);
}
