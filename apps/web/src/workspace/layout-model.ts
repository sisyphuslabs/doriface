import type { Terminal } from "@doriface/protocol";
import { type Node, panesOf, tabsOf, terminalBlock } from "@doriface/protocol/layout";
import { tabKey, type View } from "../layout/view.ts";
import { machineOf } from "./model.ts";
import type { MachineLayout } from "./use-layout-docs.ts";

export interface LayoutPane {
  readonly id: string;
  /** The terminal's address as this core names it (`build-box/t3`), or null for a herdr-app panel. */
  readonly address: string | null;
  readonly mod: string | null;
}

export interface LayoutTab {
  readonly key: string;
  readonly id: string;
  readonly space: string;
  readonly machine: string | null;
  readonly name: string;
  readonly root: Node;
  readonly panes: readonly LayoutPane[];
  readonly readOnly: string | null;
  /** Not in any document (the first live terminal shown alone, or a loose tab); written once it is split. */
  readonly transient: boolean;
}

export const TRANSIENT = "transient";
const LOOSE = "loose:";
export const looseKey = (address: string): string => `${LOOSE}${address}`;

export const qualify = (local: string, machine: string | null): string =>
  machine === null ? local : `${machine}/${local}`;

export function localOf(address: string): string {
  const slash = address.indexOf("/");
  return slash === -1 ? address : address.slice(slash + 1);
}

function docTabs(layout: MachineLayout): LayoutTab[] {
  if (layout.doc === null) return [];
  return tabsOf(layout.doc).map((tab) => ({
    key: tabKey(layout.machineId, tab.id),
    id: tab.id,
    space: tab.space,
    machine: layout.machine,
    name: tab.name,
    root: tab.root,
    panes: panesOf(tab.root).map((pane) => ({
      id: pane.id,
      address: pane.terminal === null ? null : qualify(pane.terminal, layout.machine),
      mod: pane.mod,
    })),
    readOnly: layout.readOnly,
    transient: false,
  }));
}

function looseTab(address: string, layouts: readonly MachineLayout[]): LayoutTab {
  const machine = machineOf(address) ?? null;
  const owner = layouts.find((layout) => layout.machine === machine);
  return {
    key: looseKey(address),
    id: looseKey(address),
    space: "",
    machine,
    name: "",
    root: { children: [terminalBlock(TRANSIENT, localOf(address))], id: "", type: "row" },
    panes: [{ id: TRANSIENT, address, mod: null }],
    readOnly: owner?.readOnly ?? "the machine is not connected",
    transient: true,
  };
}

/**
 * Every tab of every machine's document, this core's first, then the terminals opened on this screen while their
 * machine's layout could not take a tab (`loose`: offline, loading). With no tab at all, the first live terminal is
 * shown alone, as it opened before the layout lived in the core.
 */
export function buildTabs(
  layouts: readonly MachineLayout[],
  terminals: readonly Terminal[],
  loose: readonly string[] = [],
): LayoutTab[] {
  const tabs = layouts.flatMap(docTabs);
  const shown = new Set(tabs.flatMap((tab) => tab.panes.map((pane) => pane.address)));
  const extra = loose.filter((address) => !shown.has(address)).map((address) => looseTab(address, layouts));
  if (tabs.length + extra.length > 0) return [...tabs, ...extra];
  const local = layouts.find((layout) => layout.machine === null);
  const first = terminals.find((terminal) => terminal.state === "live");
  if (local === undefined || !local.loaded || first === undefined) return [];
  return [{ ...looseTab(first.address, layouts), key: TRANSIENT, id: TRANSIENT }];
}

export interface Picked {
  readonly active: LayoutTab | null;
  readonly focused: LayoutPane | null;
  readonly zoomed: string | null;
}

/** The selected tab and its focused pane: what the view remembers when it is still there, else the first. */
export function pick(tabs: readonly LayoutTab[], view: View): Picked {
  const active = tabs.find((tab) => tab.key === view.active) ?? tabs[0] ?? null;
  if (active === null) return { active, focused: null, zoomed: null };
  const remembered = view.focused[active.key];
  const focused = active.panes.find((pane) => pane.id === remembered) ?? active.panes[0] ?? null;
  const zoomed = view.zoomed[active.key];
  return { active, focused, zoomed: active.panes.some((pane) => pane.id === zoomed) ? (zoomed ?? null) : null };
}

/**
 * What a new tab for `address` does with the tab in view when no document holds that tab (`transient`). One of the new
 * tab's machine goes beside it in the same write (`with-new`) when that layout takes edits. The first live terminal
 * shown alone goes to its own machine's layout (`apart`) otherwise, as buildTabs stops showing it once any document
 * holds a tab; a loose tab stays as it is.
 */
export function keepTransient(
  active: LayoutTab | null,
  address: string,
  writable: boolean,
): "with-new" | "apart" | null {
  if (active === null || !active.transient || active.panes[0]?.address === address) return null;
  if (writable && active.machine === (machineOf(address) ?? null)) return "with-new";
  return active.key === TRANSIENT ? "apart" : null;
}

export function findTerminal(tabs: readonly LayoutTab[], address: string): { tab: LayoutTab; pane: LayoutPane } | null {
  for (const tab of tabs) {
    const pane = tab.panes.find((each) => each.address === address);
    if (pane !== undefined) return { tab, pane };
  }
  return null;
}
