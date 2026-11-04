import { lastIndex, optionRows, type ScreenPrompt } from "./approval-rows.ts";

const QUESTION = /^\s*Would you like to (.+)\?\s*$/;
const FOOTER = /\besc to cancel\b/;
const KEYED = /^(.*\S)\s+\((\S+)\)$/;
/** How far below the question the dialog's footer can be: its details and option rows, wrapped or not. */
const DIALOG_ROWS = 24;

/**
 * Codex's approval dialog, as 0.166.0 draws it under hc:
 *
 *       Would you like to run the following command?
 *       Reason: Create the probe file
 *       $ touch probe-a.txt
 *     › 1. Yes, proceed (y)
 *       2. Yes, and don't ask again for commands that start with `touch probe-a.txt` (p)
 *       3. No, and tell Codex what to do differently (esc)
 *       Press enter to confirm or esc to cancel
 *
 * Each row prints its own key in parentheses: Allow is the "Yes, proceed" row's, Deny the "No" row's. Those keys answer
 * wherever the cursor sits.
 */
export function readCodexPrompt(lines: readonly string[]): ScreenPrompt | undefined {
  const question = lastIndex(lines, (line) => QUESTION.test(line));
  if (question === -1) return undefined;
  const below = lines.slice(question + 1, question + 1 + DIALOG_ROWS);
  const footerAt = below.findIndex((line) => FOOTER.test(line));
  if (footerAt === -1) return undefined;
  const rows = optionRows(below.slice(0, footerAt)).flatMap((row) => {
    const keyed = KEYED.exec(row.label);
    return keyed?.[1] === undefined || keyed[2] === undefined
      ? []
      : [{ number: row.number, label: keyed[1], key: keyed[2] }];
  });
  const allow = rows.find((row) => row.label.startsWith("Yes, proceed"));
  const deny = rows.find((row) => row.label.startsWith("No"));
  if (allow === undefined || deny === undefined) return undefined;

  const firstOption = below.findIndex((line) => /^\s*(?:[❯›>]\s*)?\d+\.\s/.test(line));
  const details = below.slice(0, firstOption).map((line) => line.trim());
  const commandAt = details.findIndex((line) => line.startsWith("$ "));
  const asked = QUESTION.exec(lines[question] ?? "")?.[1] ?? "";
  const command =
    commandAt === -1
      ? asked
      : details
          .slice(commandAt)
          .filter((line) => line !== "")
          .join("\n")
          .replace(/^\$ /, "");
  const block = [
    lines[question]?.trim() ?? "",
    ...details.filter((line) => line !== ""),
    ...rows.map((row) => `${row.number}. ${row.label} (${row.key})`),
    below[footerAt]?.trim() ?? "",
  ].join("\n");
  return {
    agent: "Codex",
    asks: /^run\b/.test(asked) ? "wants to run" : "asks for permission",
    command,
    keys: { allow: allow.key, deny: deny.key },
    block,
  };
}
