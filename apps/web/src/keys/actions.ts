export type Scope = "app" | "terminal";

export interface ActionDef {
  /** Our id, herdr-app style: `tab.new`, `pane.go:left`, `send:<text>`. */
  readonly id: string;
  readonly scope: Scope;
  readonly label: string;
  /** Ghostty's name for the same action, used by keybind import and export. */
  readonly ghostty?: string;
}

const app = (id: string, label: string, ghostty?: string): ActionDef =>
  ghostty === undefined ? { id, scope: "app", label } : { id, scope: "app", label, ghostty };
const term = (id: string, label: string, ghostty?: string): ActionDef =>
  ghostty === undefined ? { id, scope: "terminal", label } : { id, scope: "terminal", label, ghostty };

export const ACTIONS: readonly ActionDef[] = [
  app("tab.new", "New tab", "new_tab"),
  app("tab.close", "Close tab", "close_surface"),
  app("tab.next", "Next tab", "next_tab"),
  app("tab.prev", "Previous tab", "previous_tab"),
  ...Array.from({ length: 9 }, (_, index) =>
    app(`tab.select:${index + 1}`, `Go to tab ${index + 1}`, `goto_tab:${index + 1}`),
  ),
  app("tab.last", "Go to last tab", "last_tab"),
  app("pane.split", "Split or unsplit"),
  app("pane.close", "Close pane"),
  app("pane.go:left", "Focus pane left", "goto_split:left"),
  app("pane.go:right", "Focus pane right", "goto_split:right"),
  app("agent.next", "Next agent"),
  app("agent.prev", "Previous agent"),
  app("layout.toggle:sidebar", "Show or hide the sidebar"),
  app("app.settings", "Open settings", "open_config"),
  app("app.zoom_in", "Larger terminal text", "increase_font_size:1"),
  app("app.zoom_out", "Smaller terminal text", "decrease_font_size:1"),
  app("app.zoom_reset", "Reset terminal text size", "reset_font_size"),
  term("terminal.copy", "Copy", "copy_to_clipboard"),
  term("terminal.paste", "Paste", "paste_from_clipboard"),
  term("terminal.select_all", "Select all", "select_all"),
  term("terminal.clear", "Clear screen", "clear_screen"),
  term("terminal.scroll:top", "Scroll to top", "scroll_to_top"),
  term("terminal.scroll:bottom", "Scroll to bottom", "scroll_to_bottom"),
  term("terminal.scroll:page_up", "Scroll a page up", "scroll_page_up"),
  term("terminal.scroll:page_down", "Scroll a page down", "scroll_page_down"),
  term("terminal.prompt:prev", "Previous prompt", "jump_to_prompt:-1"),
  term("terminal.prompt:next", "Next prompt", "jump_to_prompt:1"),
];

export const ACTION_BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTIONS.map((def) => [def.id, def]));
const ACTION_BY_GHOSTTY: ReadonlyMap<string, ActionDef> = new Map(
  ACTIONS.flatMap((def) => (def.ghostty === undefined ? [] : [[def.ghostty, def] as const])),
);

const SEND_LABEL: Readonly<Record<string, string>> = {
  "\u0001": "Send ^A (line start)",
  "\u0005": "Send ^E (line end)",
  "\u0015": "Send ^U (delete to line start)",
  "\u0017": "Send ^W (delete word)",
  "\u001bb": "Send Esc b (word left)",
  "\u001bf": "Send Esc f (word right)",
};

/** The action for an id, including `send:<text>` which is any text written to the terminal. */
export function actionFor(id: string): ActionDef | null {
  const known = ACTION_BY_ID.get(id);
  if (known !== undefined) return known;
  if (!id.startsWith("send:")) return null;
  const text = id.slice(5);
  return {
    id,
    scope: "terminal",
    label: SEND_LABEL[text] ?? `Send ${JSON.stringify(text)}`,
    ghostty: `text:${escapeGhostty(text)}`,
  };
}

function escapeGhostty(text: string): string {
  return [...text]
    .map((c) => {
      if (c === "\\") return "\\\\";
      const code = c.charCodeAt(0);
      return code < 0x20 ? `\\x${code.toString(16).padStart(2, "0")}` : c;
    })
    .join("");
}

function unescapeGhostty(text: string): string {
  return text.replace(/\\x([0-9a-f]{2})|\\(.)/gi, (_, hex: string | undefined, other: string | undefined) =>
    hex === undefined ? (other ?? "") : String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/** Our id for a Ghostty action name; `text:` becomes `send:`, `unbind` is null, unknown is undefined. */
export function actionFromGhostty(name: string): string | null | undefined {
  if (name === "unbind") return null;
  if (name.startsWith("text:")) return `send:${unescapeGhostty(name.slice(5))}`;
  return ACTION_BY_GHOSTTY.get(name)?.id;
}
