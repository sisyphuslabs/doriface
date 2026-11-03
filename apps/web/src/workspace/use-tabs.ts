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
  close(address: string): void;
  toggleSplit(): void;
  /** Marks a shown pane as the focused one. */
  focus(address: string): void;
}

/** Open tabs follow live terminals: a removed terminal drops its tab, the first live one opens by default. */
export function useTabs(terminals: readonly Terminal[]): Tabs {
  const [state, setState] = useState<TabsState>({ open: [], active: null, split: null });

  useEffect(() => {
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
      const other = prev.open.find((address) => address !== prev.active) ?? null;
      return { ...prev, split: other };
    });
  }, []);

  const focus = useCallback((address: string) => {
    setState((prev) => {
      if (prev.active === address || prev.split !== address) return prev;
      return { ...prev, active: address, split: prev.active };
    });
  }, []);

  return { ...state, select, close, toggleSplit, focus };
}
