import type { Tabs } from "./use-tabs.ts";

export type Shell = "desktop" | "phone";

/** The app actions each shell's palette may offer; that shell's handler takes every one of them. */
const SHELL_ACTIONS: Readonly<Record<Shell, readonly string[]>> = {
  desktop: ["tab.new", "pane.split", "layout.toggle:sidebar", "app.zoom_in", "app.zoom_out", "app.settings"],
  phone: ["tab.new", "app.zoom_in", "app.zoom_out", "app.settings"],
};

/** What the palette lists right now: splitting needs two open tabs, so it is left out until then. */
export function availableActions(shell: Shell, tabs: Pick<Tabs, "open">): readonly string[] {
  return SHELL_ACTIONS[shell].filter((id) => id !== "pane.split" || tabs.open.length >= 2);
}
