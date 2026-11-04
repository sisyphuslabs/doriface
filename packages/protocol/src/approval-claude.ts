import { lastIndex, type OptionRow, optionRows, type ScreenPrompt } from "./approval-rows.ts";

const QUESTION = /^\s*Do you want to .+\?\s*$/;
const FOOTER = /\bEsc to cancel\b/;
const DIALOG_TOP = /^─{10,}$/;
const COMMAND_RULE = /^╌{10,}$/;
const TIP = /^\s*Tip:/;
/** How far below the question the dialog's footer can be: its option rows, wrapped or not. */
const DIALOG_ROWS = 16;

/**
 * Claude Code's permission dialog, as 2.1.306 draws it under hc:
 *
 *     ──────────────
 *      Bash command
 *      Tip: ...                  (sometimes)
 *      Create the probe file     (the tool's description)
 *     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *      touch probe-a.txt
 *     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *      Do you want to proceed?
 *      ❯ 1. Yes
 *        2. Yes, and always allow ...
 *        4. No
 *      Esc to cancel · Tab to amend
 *
 * Allow is the number of the plain "Yes" row, which picks it wherever the cursor sits (Enter would confirm the cursor's
 * row). Deny is Esc, the dialog's own cancel. A dialog without both is not answered from outside the terminal.
 */
export function readClaudePrompt(lines: readonly string[]): ScreenPrompt | undefined {
  const question = lastIndex(lines, (line) => QUESTION.test(line));
  if (question === -1) return undefined;
  const below = lines.slice(question + 1, question + 1 + DIALOG_ROWS);
  const footerAt = below.findIndex((line) => FOOTER.test(line));
  if (footerAt === -1) return undefined;
  const options: OptionRow[] = optionRows(below.slice(0, footerAt));
  const yes = options.find((row) => row.label === "Yes");
  if (yes === undefined) return undefined;

  const top = lastIndex(lines, (line) => DIALOG_TOP.test(line), question);
  const body = lines.slice(top + 1, question);
  const header = body.find((line) => line.trim() !== "")?.trim() ?? "";
  const rules = body.flatMap((line, index) => (COMMAND_RULE.test(line) ? [index] : []));
  const between =
    rules.length >= 2
      ? body.slice((rules[0] ?? 0) + 1, rules[1])
      : [lines[question]?.trim().replace(/^Do you want to /, "") ?? ""];
  const command = between
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
  if (command === "") return undefined;

  const block = [
    ...body.filter((line) => !TIP.test(line)).map((line) => line.trim()),
    lines[question]?.trim() ?? "",
    ...options.map((row) => `${row.number}. ${row.label}`),
    below[footerAt]?.trim() ?? "",
  ].join("\n");
  return {
    agent: "Claude Code",
    asks: /^Bash\b/.test(header) ? "wants to run" : "asks for permission",
    command,
    keys: { allow: yes.number, deny: "esc" },
    block,
  };
}
