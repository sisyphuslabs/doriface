import type { Terminal } from "@doriface/protocol";
import { useNavigate } from "@tanstack/react-router";
import { terminalConfigStore } from "../ghostty/config-store.ts";
import { single, withValues } from "../ghostty/config.ts";
import { useActionHandler } from "../keys/dispatcher.ts";
import type { Tabs } from "./use-tabs.ts";

export interface AppActionTargets {
  readonly terminals: readonly Terminal[];
  readonly tabs: Tabs;
  readonly onNew: () => void;
  readonly onToggleSidebar: () => void;
}

const FONT_STEP = 1;

function zoom(delta: number | null): void {
  const config = terminalConfigStore.config;
  const next = delta === null ? [] : [String(Number(single(config, "font-size")) + delta)];
  void terminalConfigStore.update(withValues(config, "font-size", next));
}

function neighbour(list: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (list.length === 0) return null;
  const index = current === null ? -1 : list.indexOf(current);
  return list[(index + step + list.length) % list.length] ?? null;
}

export function useAppActions({ terminals, tabs, onNew, onToggleSidebar }: AppActionTargets): void {
  const navigate = useNavigate();
  useActionHandler("app", (action) => {
    const live = terminals.filter((terminal) => terminal.state === "live").map((terminal) => terminal.address);
    const select = (address: string | null): boolean => {
      if (address === null) return false;
      tabs.select(address);
      return true;
    };
    const [verb, argument = ""] = action.split(":");
    switch (verb) {
      case "tab.new":
        onNew();
        return true;
      case "tab.close":
        return tabs.active === null ? false : (tabs.close(tabs.active), true);
      case "tab.next":
        return select(neighbour(tabs.open, tabs.active, 1));
      case "tab.prev":
        return select(neighbour(tabs.open, tabs.active, -1));
      case "tab.select":
        return select(tabs.open[Number(argument) - 1] ?? null);
      case "tab.last":
        return select(tabs.open.at(-1) ?? null);
      case "pane.split":
        return tabs.open.length < 2 ? false : (tabs.toggleSplit(), true);
      case "pane.close":
        return tabs.split === null ? false : (tabs.toggleSplit(), true);
      case "pane.go":
        if (tabs.split === null) return false;
        tabs.focus(
          argument === "left" ? (tabs.open.find((address) => address !== tabs.active) ?? tabs.split) : tabs.split,
        );
        return true;
      case "agent.next":
        return select(neighbour(live, tabs.active, 1));
      case "agent.prev":
        return select(neighbour(live, tabs.active, -1));
      case "layout.toggle":
        onToggleSidebar();
        return true;
      case "app.settings":
        void navigate({ to: "/settings" });
        return true;
      case "app.zoom_in":
        return (zoom(FONT_STEP), true);
      case "app.zoom_out":
        return (zoom(-FONT_STEP), true);
      case "app.zoom_reset":
        return (zoom(null), true);
      default:
        return false;
    }
  });
}
