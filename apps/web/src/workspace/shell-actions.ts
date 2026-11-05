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
    "pane.split",
    "tab.move:left",
    "tab.move:right",
    "session.rename",
    "session.end",
    "voice.dictate",
    "layout.toggle:sidebar",
    "app.zoom_in",
    "app.zoom_out",
    "app.settings",
  ],
  phone: ["tab.new", "session.rename", "session.end", "voice.dictate", "app.zoom_in", "app.zoom_out", "app.settings"],
};

/** Actions on the session in view: rename, end, and dictating into it. */
const SESSION_ACTIONS = new Set(["session.rename", "session.end", "voice.dictate"]);

/** The strip's tab keys in order, and the selected tab's: what moving a tab is measured against. */
export interface Strip {
  readonly keys: readonly string[];
  readonly active: string | null;
}

const NO_STRIP: Strip = { keys: [], active: null };

/** Whether the active tab has a neighbour on that side to move past. */
function canMove(id: string, { keys, active }: Strip): boolean {
  const at = active === null ? -1 : keys.indexOf(active);
  if (at === -1) return false;
  return id === "tab.move:left" ? at > 0 : at < keys.length - 1;
}

/** Splitting needs a terminal in view whose layout takes edits; until then it is listed as unavailable, with why. */
function unavailable(id: string, inView: boolean, readOnly: string | null): string | undefined {
  if (id !== "pane.split") return undefined;
  return inView ? (readOnly ?? undefined) : "No terminal to split";
}

/**
 * What the palette lists right now. Rename and End session apply to the session in view, so with none in view they
 * are left out, as a palette leaves out commands that do not apply, and so is moving the active tab past an end of the
 * strip; Split is listed as unavailable until it can run.
 */
export function availableActions(
  shell: Shell,
  inView: boolean,
  readOnly: string | null = null,
  strip: Strip = NO_STRIP,
): readonly ShellAction[] {
  return SHELL_ACTIONS[shell]
    .filter((id) => inView || !SESSION_ACTIONS.has(id))
    .filter((id) => !id.startsWith("tab.move:") || canMove(id, strip))
    .map((id) => {
      const reason = unavailable(id, inView, readOnly);
      return reason === undefined ? { id } : { id, unavailable: reason };
    });
}
