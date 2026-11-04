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
  /** Shown while no tab exists anywhere, the way the first live terminal opened before; written once it is edited. */
  readonly transient: boolean;
}

export const TRANSIENT = "transient";

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

/** Every tab of every machine's document, this core's first; or the first live terminal alone while there is none. */
export function buildTabs(layouts: readonly MachineLayout[], terminals: readonly Terminal[]): LayoutTab[] {
  const tabs = layouts.flatMap(docTabs);
  const local = layouts.find((layout) => layout.machine === null);
  if (tabs.length > 0 || local === undefined || !local.loaded) return tabs;
  const first = terminals.find((terminal) => terminal.state === "live");
  if (first === undefined) return tabs;
  const machine = machineOf(first.address) ?? null;
  const owner = layouts.find((layout) => layout.machine === machine);
  return [
    {
      key: TRANSIENT,
      id: TRANSIENT,
      space: "",
      machine,
      name: "",
      root: { children: [terminalBlock(TRANSIENT, localOf(first.address))], id: "", type: "row" },
      panes: [{ id: TRANSIENT, address: first.address, mod: null }],
      readOnly: owner?.readOnly ?? "the machine is not connected",
      transient: true,
    },
  ];
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

export function findTerminal(tabs: readonly LayoutTab[], address: string): { tab: LayoutTab; pane: LayoutPane } | null {
  for (const tab of tabs) {
    const pane = tab.panes.find((each) => each.address === address);
    if (pane !== undefined) return { tab, pane };
  }
  return null;
}
