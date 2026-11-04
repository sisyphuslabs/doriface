export type ApprovalAnswer = "allow" | "deny";

/** A permission prompt as an agent drew it on its live screen. */
export interface ScreenPrompt {
  readonly agent: string;
  /** The agent's own verb phrase: "wants to run". */
  readonly asks: string;
  /** The exact command or tool call it asks about, whole. */
  readonly command: string;
  /** The agent's own key for each answer, as hc `terminal.keys` names it, pressed as if typed. */
  readonly keys: { readonly [A in ApprovalAnswer]: string };
  /** The dialog's text without the cursor glyph or rotating tips: what identifies this prompt on screen. */
  readonly block: string;
}

/** One agent's reader: the screen's lines, bottom row last, to the prompt it shows, if any. */
export type PromptReader = (lines: readonly string[]) => ScreenPrompt | undefined;

/** An option row such as `❯ 1. Yes` or `  3. No, and tell Codex what to do differently (esc)`, without its cursor. */
export interface OptionRow {
  readonly number: string;
  readonly label: string;
}

const OPTION = /^\s*(?:[❯›>]\s*)?(\d+)\.\s+(.+)$/;

function optionRow(line: string): OptionRow | undefined {
  const match = OPTION.exec(line);
  return match?.[1] === undefined || match[2] === undefined ? undefined : { number: match[1], label: match[2].trim() };
}

/**
 * The option list that starts at the first option row in `lines` and ends at the first blank row. A row the agent
 * wrapped onto the next line (a narrow terminal) joins the option above it.
 */
export function optionRows(lines: readonly string[]): OptionRow[] {
  const rows: OptionRow[] = [];
  for (const line of lines) {
    const row = optionRow(line);
    const last = rows.at(-1);
    if (row !== undefined) rows.push(row);
    else if (last !== undefined && line.trim() === "") break;
    else if (last !== undefined) rows[rows.length - 1] = { number: last.number, label: `${last.label} ${line.trim()}` };
  }
  return rows;
}

/** The last row at or above `from` that `test` accepts, scanning up. */
export function lastIndex(lines: readonly string[], test: (line: string) => boolean, from = lines.length - 1): number {
  for (let index = from; index >= 0; index--) if (test(lines[index] ?? "")) return index;
  return -1;
}
