import type { JsonObject, Terminal } from "@doriface/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTab as addDocTab,
  type Axis,
  type DocEdit,
  editTab,
  freshId,
  type Node,
  removeTab,
  splitPane,
  tabsOf,
  terminalBlock,
} from "@doriface/protocol/layout";
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
import { usePaneMoves, type PaneMoves } from "./use-pane-moves.ts";
import { splitLanding } from "./split-landing.ts";
import { orderTabs, type TabMove } from "./tab-order.ts";
import { type Leaving, useDropPane } from "./use-drop-pane.ts";
import { useTabMoves } from "./use-tab-moves.ts";
import { LAYOUT_LOADING, type MachineLayout } from "./use-layout-docs.ts";

export interface Layout extends PaneMoves {
  readonly tabs: readonly LayoutTab[];
  readonly active: LayoutTab | null;
  readonly focused: LayoutPane | null;
  readonly zoomed: string | null;
  readonly selectTab: (key: string) => void;
  readonly focusPane: (tab: string, pane: string) => void;
  /** Focuses the pane that shows the terminal, or opens it in a new tab. */
  readonly openTerminal: (address: string) => void;
  /** Puts a terminal started for a pane (the focused one unless `target` names another) beside it, and focuses it. */
  readonly split: (axis: Axis, address: string, target?: PaneTarget, pane?: string) => void;
  /** Takes the terminal's pane out of its tab, and the tab when it was the last pane; the terminal is untouched. */
  readonly dropPane: (address: string) => void;
  readonly closeTab: (key: string) => void;
  /** The pane this screen split off last, which grows in from the pane it came from. */
  readonly fresh: string | null;
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

export interface PaneTarget {
  readonly tab: string;
  readonly pane: string;
}

const HISTORY = 32;

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
  /** machine.list has answered since the workspace mounted, so every added machine's layout is known. */
  machinesListed = true,
): Layout {
  const [view, setView] = useState<View>(() => loadView(core));
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => saveView(core, view), [core, view]);
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

  // Panes focused per tab, oldest first, as herdr-app's `before`: moving focus prefers the pane left last.
  const history = useRef(new Map<string, string[]>());
  const show = useCallback((key: string, pane: string | null): void => {
    if (pane !== null) {
      const visited = (history.current.get(key) ?? []).filter((id) => id !== pane);
      history.current.set(key, [...visited, pane].slice(-HISTORY));
    }
    setView((prev) => {
      // Focus leaving a zoomed pane shows every pane again, as herdr-app and Ghostty unzoom on a focus move or a split,
      // so focus never sits on a pane the zoom hides and a close never acts on one out of view.
      const { [key]: inTab, ...others } = prev.zoomed;
      return {
        ...prev,
        active: key,
        focused: pane === null ? prev.focused : { ...prev.focused, [key]: pane },
        zoomed: pane === null || inTab === undefined || inTab === pane ? prev.zoomed : others,
      };
    });
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
    (axis: Axis, address: string, target?: PaneTarget, made: string = freshId("p")): void => {
      const tab = target === undefined ? active : (tabs.find((each) => each.key === target.tab) ?? null);
      // A named pane may not be on screen yet (a split still being written); the document edit finds it.
      const from = target === undefined ? focused : { id: target.pane };
      if (tab === null || from === null) return addTab(address);
      const layout = layoutOf(tab.machine);
      if (layout === undefined || layout.readOnly !== null) return undefined;
      const pane = made;
      const block = terminalBlock(pane, localOf(address));
      if (tab.transient) {
        const copy = written(tab);
        const root = splitPane(copy.root, copy.pane, axis, block, freshId("s"));
        if (root === null) return undefined;
        const space = (doc: JsonObject | null) => ({ id: spaceOf(doc) ?? freshId("spc"), folder: "" });
        void layout.edit((doc) => addDocTab(doc, space(doc), { id: copy.id, name: "", root }));
        setFresh(pane);
        return show(tabKey(layout.machineId, copy.id), pane);
      }
      const container = freshId("s");
      // Whether the edit last found the pane gone; a write that failed instead was already reported by `edit`.
      let gone = false;
      void layout
        .edit((doc) => {
          const next =
            doc === null ? null : editTab(doc, tab.id, (root) => splitPane(root, from.id, axis, block, container));
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
      setFresh(pane);
      return show(tab.key, pane);
    },
    [active, addTab, focused, keepHere, layoutOf, show, tabs, told],
  );

  // As herdr-app's remove_pane: focus goes back to the pane focused before the closed one that is still there. A write
  // that fails puts the pane back, and focus with it, unless it has moved on since.
  const leave = useCallback((leaving: Leaving): (() => void) => {
    const key = leaving.tab.key;
    const gone = leaving.pane.id;
    const had = history.current.get(key) ?? [];
    const left = had.filter((id) => id !== gone);
    history.current.set(key, left);
    const here = new Set(leaving.tab.panes.map((pane) => pane.id));
    const before = left.findLast((id) => here.has(id));
    if (before !== undefined)
      setView((prev) => (prev.focused[key] === gone ? { ...prev, focused: { ...prev.focused, [key]: before } } : prev));
    return () => {
      if (had.includes(gone)) {
        const now = (history.current.get(key) ?? []).filter((id) => id !== gone);
        history.current.set(key, [...now, gone].slice(-HISTORY));
      }
      if (before !== undefined)
        setView((prev) =>
          prev.focused[key] === before ? { ...prev, focused: { ...prev.focused, [key]: gone } } : prev,
        );
    };
  }, []);
  const dropPane = useDropPane(tabs, layoutOf, setLoose, leave);

  const closeTab = useCallback(
    (key: string): void => {
      const tab = tabs.find((each) => each.key === key);
      if (tab === undefined) return;
      if (tab.transient) return setLoose((prev) => prev.filter((address) => address !== tab.panes[0]?.address));
      void layoutOf(tab.machine)?.edit((doc) => (doc === null ? null : removeTab(doc, tab.id)));
    },
    [layoutOf, tabs],
  );

  const moves = usePaneMoves({ active, focused, layoutOf, show, setView, history: history.current });
  const selectTab = useCallback((key: string): void => show(key, null), [show]);
  const focusPane = useCallback((tab: string, pane: string): void => show(tab, pane), [show]);
  const { moveTab, lastMove } = useTabMoves(tabs, setView);

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
    fresh,
    ...moves,
    moveTab,
    lastMove,
    restored: machinesListed && layouts.every((layout) => layout.loaded || layout.readOnly !== LAYOUT_LOADING),
  };
}

function spaceOf(doc: JsonObject | null): string | null {
  return doc === null ? null : (tabsOf(doc)[0]?.space ?? null);
}
