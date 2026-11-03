import type { Terminal } from "@doriface/protocol";
import { useNavigate } from "@tanstack/react-router";
import { terminalConfigStore } from "../ghostty/config-store.ts";
import { single, withValues, withoutKey, type TerminalConfig } from "../ghostty/config.ts";
import { KEY_BY_NAME } from "../ghostty/keys.ts";
import { useActionHandler, type ActionHandler } from "../keys/dispatcher.ts";
import type { Tabs } from "./use-tabs.ts";

export interface AppActionTargets {
  readonly terminals: readonly Terminal[];
  readonly tabs: Tabs;
  readonly onNew: () => void;
  readonly onToggleSidebar: () => void;
  /** Moves focus from the terminal to the sidebar, or back. */
  readonly onFocusSidebar: () => void;
}

const FONT_STEP = 1;

/** Steps font-size within the schema's bounds; null resets it to the default. */
export function zoomedConfig(config: TerminalConfig, delta: number | null): TerminalConfig {
  if (delta === null) return withoutKey(config, "font-size");
  const kind = KEY_BY_NAME.get("font-size")?.kind;
  const [min, max] = kind?.type === "number" ? [kind.min, kind.max] : [1, 1000];
  const size = Math.min(max, Math.max(min, Number(single(config, "font-size")) + delta));
  return withValues(config, "font-size", [String(size)]);
}

function zoom(delta: number | null): void {
  void terminalConfigStore.update((current) => zoomedConfig(current, delta));
}

/** Whether selecting the address does anything: a null target or the active tab leaves the key unhandled. */
export function shouldSelect(address: string | null, active: string | null): boolean {
  return address !== null && address !== active;
}

export function neighbour(list: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (list.length === 0) return null;
  const index = current === null ? -1 : list.indexOf(current);
  const target = list[(index + step + list.length) % list.length] ?? null;
  return target === current ? null : target;
}

function zoomAction(verb: string): boolean {
  if (verb === "app.zoom_in") zoom(FONT_STEP);
  else if (verb === "app.zoom_out") zoom(-FONT_STEP);
  else if (verb === "app.zoom_reset") zoom(null);
  else return false;
  return true;
}

/** The phone shell's app actions: new terminal, settings and terminal text size; it has no tabs, panes or sidebar. */
export function phoneActions(onNew: () => void, openSettings: () => void): ActionHandler {
  return (action) => {
    if (action === "tab.new") return (onNew(), true);
    if (action === "app.settings") return (openSettings(), true);
    return zoomAction(action);
  };
}

export function usePhoneActions(onNew: () => void): void {
  const navigate = useNavigate();
  useActionHandler(
    "app",
    phoneActions(onNew, () => void navigate({ to: "/settings" })),
  );
}

export function useAppActions(targets: AppActionTargets): void {
  const navigate = useNavigate();
  useActionHandler(
    "app",
    desktopActions(targets, () => void navigate({ to: "/settings" })),
  );
}

function selectTab(tabs: Tabs, address: string | null): boolean {
  // Nothing to do leaves the key to the terminal (alt+up in a shell with one tab open).
  if (address === null || !shouldSelect(address, tabs.active)) return false;
  tabs.select(address);
  return true;
}

export function desktopActions(
  { terminals, tabs, onNew, onToggleSidebar, onFocusSidebar }: AppActionTargets,
  openSettings: () => void,
): ActionHandler {
  return (action) => {
    const live = terminals.filter((terminal) => terminal.state === "live").map((terminal) => terminal.address);
    const [verb, argument = ""] = action.split(":");
    switch (verb) {
      case "tab.new":
        onNew();
        return true;
      case "tab.close":
        return tabs.active === null ? false : (tabs.close(tabs.active), true);
      case "tab.next":
        return selectTab(tabs, neighbour(tabs.open, tabs.active, 1));
      case "tab.prev":
        return selectTab(tabs, neighbour(tabs.open, tabs.active, -1));
      case "tab.select":
        return selectTab(tabs, tabs.open[Number(argument) - 1] ?? null);
      case "tab.last":
        return selectTab(tabs, tabs.open.at(-1) ?? null);
      case "pane.split":
        return tabs.open.length < 2 ? false : (tabs.toggleSplit(), true);
      case "pane.close":
        return tabs.split === null ? false : (tabs.toggleSplit(), true);
      case "pane.go":
        if (tabs.split === null) return false;
        // The split shows the active tab on the left and the split tab on the right.
        if (argument === "left" && tabs.active !== null) tabs.focus(tabs.active);
        else tabs.focus(tabs.split);
        return true;
      case "agent.next":
        return selectTab(tabs, neighbour(live, tabs.active, 1));
      case "agent.prev":
        return selectTab(tabs, neighbour(live, tabs.active, -1));
      case "layout.toggle":
        onToggleSidebar();
        return true;
      case "layout.focus":
        onFocusSidebar();
        return true;
      case "app.settings":
        openSettings();
        return true;
      default:
        return zoomAction(action);
    }
  };
}
