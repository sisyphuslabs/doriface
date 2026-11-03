import type { Tabs } from "./use-tabs.ts";

export type Shell = "desktop" | "phone";

/** An app action the palette lists; `unavailable` says why it cannot run right now. */
export interface ShellAction {
  readonly id: string;
  readonly unavailable?: string;
}

/** The app actions each shell's palette may offer; that shell's handler takes every one of them. */
const SHELL_ACTIONS: Readonly<Record<Shell, readonly string[]>> = {
  desktop: ["tab.new", "pane.split", "layout.toggle:sidebar", "app.zoom_in", "app.zoom_out", "app.settings"],
  phone: ["tab.new", "app.zoom_in", "app.zoom_out", "app.settings"],
};

/** What the palette lists right now: splitting needs two open tabs, so until then it is listed as unavailable. */
export function availableActions(shell: Shell, tabs: Pick<Tabs, "open">): readonly ShellAction[] {
  return SHELL_ACTIONS[shell].map((id) =>
    id === "pane.split" && tabs.open.length < 2 ? { id, unavailable: "Needs two tabs" } : { id },
  );
}
