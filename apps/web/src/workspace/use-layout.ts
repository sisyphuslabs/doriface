import type { JsonObject, Terminal } from "@doriface/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  /** Puts a terminal started for the focused pane beside it, and focuses it. */
  readonly split: (axis: Axis, address: string) => void;
  /** Takes the terminal's pane out of its tab, and the tab when it was the last pane; the terminal is untouched. */
  readonly dropPane: (address: string) => void;
  readonly closeTab: (key: string) => void;
  /** Focuses the nearest pane that way in the tab in view; false when none lies that way, so the key stays the program's. */
  readonly go: (direction: Direction) => boolean;
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
): Layout {
  const [view, setView] = useState<View>(() => loadView(core));
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

  const show = useCallback((key: string, pane: string | null): void => {
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
      void layout
        .edit((doc) =>
          doc === null ? null : editTab(doc, active.id, (root) => splitPane(root, focused.id, axis, block, container)),
        )
        .then((placed) => {
          // The pane it split closed on another device first: the new terminal still opens, in a tab of its own.
          if (!placed) {
            addTab(address);
            told("The pane you split had closed, so the new terminal opened in a new tab.");
          }
          return placed;
        });
      return show(active.key, pane);
    },
    [active, addTab, focused, layoutOf, show, told],
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

  return { tabs, active, focused, zoomed, selectTab, focusPane, openTerminal, split, dropPane, closeTab, go };
}

function spaceOf(doc: JsonObject | null): string | null {
  return doc === null ? null : (tabsOf(doc)[0]?.space ?? null);
}
