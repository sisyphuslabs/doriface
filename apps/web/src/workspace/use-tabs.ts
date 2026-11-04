import type { MachineView, Terminal } from "@doriface/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { followTerminals, type KeyedTabs, moveTab, selectTerminal } from "./tab-follow.ts";
import { machineIds, tabAddress, tabKey } from "./tab-keys.ts";
import { loadTabs, saveTabs } from "./tab-store.ts";

export interface TabsState {
  readonly open: readonly string[];
  readonly active: string | null;
  /** The second pane of a split, or null for one pane. */
  readonly split: string | null;
}

export interface Tabs extends TabsState {
  select(address: string): void;
  /** Closing a tab as the person asked: the workspace asks first whether to keep the session running. */
  close(address: string): void;
  /** Removes the tab at once; the session keeps running. */
  drop(address: string): void;
  toggleSplit(): void;
  /** Marks a shown pane as the focused one. */
  focus(address: string): void;
  /** Moves an open tab so it ends at index `to` of `open`; shown panes and focus stay as they are. */
  move(address: string, to: number): void;
  /** The last tab moved, counted so the strip can say where it went each time, even to the same place twice. */
  readonly lastMove: TabMove | null;
}

export interface TabMove {
  readonly address: string;
  readonly count: number;
}

/**
 * Per core, so leaving the workspace (Settings, a reconnect) and coming back finds the same tabs; saved to
 * localStorage as well, so a reload finds them too, in the same order.
 */
const kept = new Map<string, KeyedTabs>();

/**
 * Open tabs follow live terminals: a removed terminal drops its tab, the first live one opens by default.
 * `terminals` is null until the core has listed them; until then the kept tabs stand as they are. Tabs are kept by
 * machine id (`tabKey`), so renaming a machine moves its tabs to the new addresses instead of closing them; `listed`
 * counts machine.list reads, which is what tells a rename from a removal (`followTerminals`).
 */
export function useTabs(
  core: string,
  terminals: readonly Terminal[] | null,
  machines: readonly MachineView[],
  listed: number,
): Tabs {
  const ids = useMemo(() => machineIds(machines), [machines]);
  const [state, setState] = useState<KeyedTabs>(() => kept.get(core) ?? loadTabs(core));
  const [lastMove, setLastMove] = useState<TabMove | null>(null);

  useEffect(() => {
    if (kept.get(core) === state) return;
    kept.set(core, state);
    saveTabs(core, state);
  }, [core, state]);

  useEffect(() => {
    if (terminals === null) return;
    setState((prev) => followTerminals(prev, terminals, ids, listed));
  }, [terminals, ids, listed]);

  // The feed as last rendered, read when a selection lands: New tab selects once terminal.run answers, by which time
  // the feed may already list the terminal (it opens at once) or not yet (it waits as pending).
  const feed = useRef(terminals);
  useEffect(() => {
    feed.current = terminals;
  }, [terminals]);
  const select = useCallback(
    (address: string) => setState((prev) => selectTerminal(prev, address, ids, feed.current)),
    [ids],
  );

  const close = useCallback(
    (address: string) => {
      const key = tabKey(address, ids);
      setState((prev) => {
        const open = prev.open.filter((entry) => entry !== key);
        const active = prev.active === key ? (open.at(-1) ?? null) : prev.active;
        const split = prev.split === key || prev.split === active ? null : prev.split;
        return { ...prev, open, active, split, pending: prev.pending === key ? null : prev.pending };
      });
    },
    [ids],
  );

  const toggleSplit = useCallback(() => {
    setState((prev) => {
      if (prev.split !== null) return { ...prev, split: null };
      const other = prev.open.find((key) => key !== prev.active);
      // The new pane takes focus, like a new split in Ghostty; the focused pane is the left one.
      return other === undefined ? prev : { ...prev, active: other, split: prev.active };
    });
  }, []);

  const focus = useCallback(
    (address: string) => {
      const key = tabKey(address, ids);
      setState((prev) => {
        if (prev.active === key || prev.split !== key) return prev;
        // Moving to the other pane is a choice of its own; a New tab still waiting for the feed no longer takes focus.
        return { ...prev, active: key, split: prev.active, pending: null };
      });
    },
    [ids],
  );

  const latest = useRef(state);
  latest.current = state;
  const move = useCallback(
    (address: string, to: number) => {
      // `to` counts the tabs `open` lists; a tab whose machine is not listed yet holds its place without one.
      const moved = (prev: KeyedTabs): KeyedTabs => {
        const target = prev.open.filter((key) => tabAddress(key, ids) !== undefined)[to];
        return target === undefined ? prev : moveTab(prev, tabKey(address, ids), prev.open.indexOf(target));
      };
      // Only a move that changes the order is announced.
      if (moved(latest.current) === latest.current) return;
      setState(moved);
      setLastMove((prev) => ({ address, count: (prev?.count ?? 0) + 1 }));
    },
    [ids],
  );

  const resolve = (key: string | null): string | null => (key === null ? null : (tabAddress(key, ids) ?? null));
  const open = state.open.flatMap((key) => tabAddress(key, ids) ?? []);
  return {
    open,
    active: resolve(state.active),
    split: resolve(state.split),
    select,
    close,
    drop: close,
    toggleSplit,
    focus,
    move,
    lastMove,
  };
}
