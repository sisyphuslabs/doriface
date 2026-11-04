import type { JsonObject, Terminal } from "@doriface/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTab as addDocTab,
  type Axis,
  type DocEdit,
  editTab,
  freshId,
  type Node,
  panesOf,
  removePane,
  removeTab,
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
  localOf,
  looseKey,
  pick,
  TRANSIENT,
  type LayoutPane,
  type LayoutTab,
} from "./layout-model.ts";
import { machineOf } from "./model.ts";
import type { MachineLayout } from "./use-layout-docs.ts";

export interface Layout {
  readonly tabs: readonly LayoutTab[];
  readonly active: LayoutTab | null;
  readonly focused: LayoutPane | null;
  readonly zoomed: string | null;
  readonly selectTab: (key: string) => void;
  readonly focusPane: (tab: string, pane: string) => void;
  /** Focuses the pane that shows the terminal, or opens it in a new tab. */
  readonly openTerminal: (address: string) => void;
  /** Puts a terminal started for a pane (the focused one unless `target` names another) beside it, and focuses it. */
  readonly split: (axis: Axis, address: string, target?: PaneTarget) => void;
  /** Takes the terminal's pane out of its tab, and the tab when it was the last pane; the terminal is untouched. */
  readonly dropPane: (address: string) => void;
  readonly closeTab: (key: string) => void;
  /**
   * Focuses the nearest pane that way in the tab in view. With no pane that way in a split tab it nudges the focused
   * pane (`bumped`) instead and still takes the key; a lone pane leaves the key to its program (false), as Ghostty does.
   */
  readonly go: (direction: Direction) => boolean;
  readonly bumped: Bump | null;
  /** The pane this screen split off last, which grows in from the pane it came from. */
  readonly fresh: string | null;
}

export interface PaneTarget {
  readonly tab: string;
  readonly pane: string;
}

export interface Bump {
  readonly pane: string;
  readonly direction: Direction;
  readonly seq: number;
}

/** Proportions are all moving focus needs, so it measures the tree in a fixed box with the panes' gap. */
const MEASURE = { x: 0, y: 0, width: 1600, height: 1000 } as const;
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
): Layout {
  const [view, setView] = useState<View>(() => loadView(core));
  const [bumped, setBumped] = useState<Bump | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => saveView(core, view), [core, view]);
  // Terminals opened while their machine's layout took no edits; this screen shows them as tabs of its own.
  const [loose, setLoose] = useState<readonly string[]>([]);
  const tabs = useMemo(() => buildTabs(layouts, terminals, loose), [layouts, terminals, loose]);
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
    setView((prev) => ({
      ...prev,
      active: key,
      focused: pane === null ? prev.focused : { ...prev.focused, [key]: pane },
    }));
  }, []);

  const addTab = useCallback(
    (address: string): void => {
      const machine = machineOf(address) ?? null;
      const layout = layoutOf(machine);
      if (layout === undefined || layout.readOnly !== null) {
        setLoose((prev) => (prev.includes(address) ? prev : [...prev, address]));
        return show(looseKey(address), TRANSIENT);
      }
      const id = freshId("tb");
      const pane = freshId("p");
      const tab: JsonObject = { id, name: "", root: rootOf(id, [terminalBlock(pane, localOf(address))]) };
      const before = active?.transient === true && active.machine === machine && active.panes[0]?.address !== address;
      const kept = before && active !== null ? written(active) : null;
      const near = active !== null && !active.transient && active.machine === machine ? active.space : null;
      void layout.edit((doc) => {
        const space = { id: near ?? spaceOf(doc) ?? freshId("spc"), folder: "" };
        const first = kept === null ? doc : addDocTab(doc, space, { id: kept.id, name: "", root: kept.root });
        return addDocTab(first, space, tab);
      });
      show(tabKey(layout.machineId, id), pane);
    },
    [active, layoutOf, show],
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
    (axis: Axis, address: string, target?: PaneTarget): void => {
      const tab = target === undefined ? active : (tabs.find((each) => each.key === target.tab) ?? null);
      const from = target === undefined ? focused : (tab?.panes.find((pane) => pane.id === target.pane) ?? null);
      if (tab === null || from === null) return addTab(address);
      const layout = layoutOf(tab.machine);
      if (layout === undefined || layout.readOnly !== null) return undefined;
      const pane = freshId("p");
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
          // The pane it split closed on another device first: the new terminal still opens, in a tab of its own.
          if (!placed && gone) {
            addTab(address);
            told("The pane you split had closed, so the new terminal opened in a new tab.");
          }
          return placed;
        });
      setFresh(pane);
      return show(tab.key, pane);
    },
    [active, addTab, focused, layoutOf, show, tabs, told],
  );

  const dropPane = useCallback(
    (address: string): void => {
      const found = findTerminal(tabs, address);
      if (found === null) return;
      if (found.tab.transient) return setLoose((prev) => prev.filter((each) => each !== address));
      const layout = layoutOf(found.tab.machine);
      void layout?.edit((doc) => {
        if (doc === null) return null;
        const tab = tabsOf(doc).find((each) => each.id === found.tab.id);
        const root = tab === undefined ? null : removePane(tab.root, found.pane.id);
        if (root === null) return null;
        return panesOf(root).length === 0 ? removeTab(doc, found.tab.id) : editTab(doc, found.tab.id, () => root);
      });
    },
    [layoutOf, tabs],
  );

  const closeTab = useCallback(
    (key: string): void => {
      const tab = tabs.find((each) => each.key === key);
      if (tab === undefined) return;
      if (tab.transient) return setLoose((prev) => prev.filter((address) => address !== tab.panes[0]?.address));
      void layoutOf(tab.machine)?.edit((doc) => (doc === null ? null : removeTab(doc, tab.id)));
    },
    [layoutOf, tabs],
  );

  const go = useCallback(
    (direction: Direction): boolean => {
      if (active === null || focused === null || active.panes.length < 2) return false;
      const { panes } = arrange(active.root, MEASURE, 8, null);
      const to = nearest(focused.id, direction, panes, history.current.get(active.key) ?? []);
      if (to === null) setBumped((prev) => ({ pane: focused.id, direction, seq: (prev?.seq ?? 0) + 1 }));
      else show(active.key, to);
      return true;
    },
    [active, focused, show],
  );

  const selectTab = useCallback((key: string): void => show(key, null), [show]);
  const focusPane = useCallback((tab: string, pane: string): void => show(tab, pane), [show]);
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
    bumped,
    fresh,
  };
}

function spaceOf(doc: JsonObject | null): string | null {
  return doc === null ? null : (tabsOf(doc)[0]?.space ?? null);
}
