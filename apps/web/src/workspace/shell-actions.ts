export type Shell = "desktop" | "phone";

/** An app action the palette lists; `unavailable` says why it cannot run right now. */
export interface ShellAction {
  readonly id: string;
  readonly unavailable?: string;
}

/** The app actions each shell's palette may offer; that shell's handler takes every one of them. */
const SHELL_ACTIONS: Readonly<Record<Shell, readonly string[]>> = {
  desktop: [
    "tab.new",
    "pane.split:right",
    "pane.split:down",
    "pane.close",
    "pane.equalize",
    "pane.zoom",
    "tab.close",
    "session.rename",
    "session.end",
    "layout.toggle:sidebar",
    "app.zoom_in",
    "app.zoom_out",
    "app.settings",
  ],
  phone: ["tab.new", "session.rename", "session.end", "app.zoom_in", "app.zoom_out", "app.settings"],
};

const SESSION_ACTIONS = new Set(["session.rename", "session.end"]);

/** Splitting needs a terminal in view whose layout takes edits; until then it is listed as unavailable, with why. */
function unavailable(id: string, inView: boolean, readOnly: string | null): string | undefined {
  if (!id.startsWith("pane.split:")) return undefined;
  return inView ? (readOnly ?? undefined) : "No terminal to split";
}

/**
 * What the palette lists right now. Rename and End session apply to the session in view, so with none in view they
 * are left out, as a palette leaves out commands that do not apply; Split is listed as unavailable until it can run.
 */
export function availableActions(
  shell: Shell,
  inView: boolean,
  readOnly: string | null = null,
): readonly ShellAction[] {
  return SHELL_ACTIONS[shell]
    .filter((id) => inView || !SESSION_ACTIONS.has(id))
    .map((id) => {
      const reason = unavailable(id, inView, readOnly);
      return reason === undefined ? { id } : { id, unavailable: reason };
    });
}
