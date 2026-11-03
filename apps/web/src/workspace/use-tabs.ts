import type { Terminal } from "@doriface/protocol";
import { useCallback, useEffect, useState } from "react";

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
}

const EMPTY: TabsState = { open: [], active: null, split: null };

/** Per core, so leaving the workspace (Settings, a reconnect) and coming back finds the same tabs. */
const kept = new Map<string, TabsState>();

/**
 * Open tabs follow live terminals: a removed terminal drops its tab, the first live one opens by default.
 * `terminals` is null until the core has listed them; until then the kept tabs stand as they are.
 */
export function useTabs(core: string, terminals: readonly Terminal[] | null): Tabs {
  const [state, setState] = useState<TabsState>(() => kept.get(core) ?? EMPTY);

  useEffect(() => {
    kept.set(core, state);
  }, [core, state]);

  useEffect(() => {
    if (terminals === null) return;
    setState((prev) => {
      const known = new Set(terminals.map((terminal) => terminal.address));
      let open = prev.open.filter((address) => known.has(address));
      const firstLive = terminals.find((terminal) => terminal.state === "live")?.address;
      if (open.length === 0 && firstLive !== undefined) open = [firstLive];
      const active = prev.active !== null && open.includes(prev.active) ? prev.active : (open[0] ?? null);
      const split = prev.split !== null && open.includes(prev.split) && prev.split !== active ? prev.split : null;
      const same = open.length === prev.open.length && active === prev.active && split === prev.split;
      return same ? prev : { open, active, split };
    });
  }, [terminals]);

  const select = useCallback((address: string) => {
    setState((prev) => ({
      open: prev.open.includes(address) ? prev.open : [...prev.open, address],
      active: address,
      split: prev.split === address ? null : prev.split,
    }));
  }, []);

  const close = useCallback((address: string) => {
    setState((prev) => {
      const open = prev.open.filter((entry) => entry !== address);
      const active = prev.active === address ? (open.at(-1) ?? null) : prev.active;
      return { open, active, split: prev.split === address || prev.split === active ? null : prev.split };
    });
  }, []);

  const toggleSplit = useCallback(() => {
    setState((prev) => {
      if (prev.split !== null) return { ...prev, split: null };
      const other = prev.open.find((address) => address !== prev.active);
      // The new pane takes focus, like a new split in Ghostty; the focused pane is the left one.
      return other === undefined ? prev : { ...prev, active: other, split: prev.active };
    });
  }, []);

  const focus = useCallback((address: string) => {
    setState((prev) => {
      if (prev.active === address || prev.split !== address) return prev;
      return { ...prev, active: address, split: prev.active };
    });
  }, []);

  return { ...state, select, close, drop: close, toggleSplit, focus };
}
