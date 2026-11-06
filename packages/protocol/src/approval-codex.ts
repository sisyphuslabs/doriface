import {
  bodyText,
  contextAbove,
  lastIndex,
  optionRow,
  optionRows,
  type PromptOption,
  type ScreenPrompt,
} from "./approval-rows.ts";

const AGENT = "Codex";
/** The person's own message in the transcript: where the agent's lines above a dialog start. */
const ASKED = /^› /;

const PERMISSION_QUESTION = /^\s*Would you like to (.+)\?\s*$/;
const PERMISSION_FOOTER = /\besc to cancel\b/;
const KEYED = /^(.*\S)\s+\((\S+)\)$/;
const DESTINATION = /^Destination:\s+(.+)$/;
/** How far below the question the dialog's footer can be: its details and option rows, wrapped or not. */
const DIALOG_ROWS = 24;

const QUESTION_COUNTER = /^\s*Question (\d+)\/(\d+)\b/;
const QUESTION_FOOTER = /\benter to submit (?:answer|all)\b/;
const INTERRUPT = /\besc to interrupt\b/;
const LABEL_DETAIL = /^(.*?\S)\s{2,}(\S.*)$/;
const NOTES = /\(tab\)\s*$/;
/** The notes row Tab opens under the cursor's option: `› Add notes`. */
const NOTES_OPEN = /^\s*›\s+Add notes\b/;

/**
 * Codex's approval dialog, as 0.166.0 and 0.167.0 draw it under hc:
 *
 *       Would you like to run the following command?        Would you like to make the following edits?
 *       Reason: Create the probe file                        Description: Apply proposed file edits
 *       $ touch probe-a.txt                                  Destination: ~/work/notes.md
 *     › 1. Yes, proceed (y)
 *       2. Yes, and don't ask again for commands that start with `touch probe-a.txt` (p)
 *       3. No, and tell Codex what to do differently (esc)
 *       Press enter to confirm or esc to cancel
 *
 * Each row prints its own key in parentheses, which answers wherever the cursor sits.
 */
/** A dialog a reader found: its prompt and the row it starts on, which says how far down the screen it is. */
interface Found {
  readonly prompt: ScreenPrompt;
  readonly top: number;
}

function readPermission(lines: readonly string[]): Found | undefined {
  const question = lastIndex(lines, (line) => PERMISSION_QUESTION.test(line));
  if (question === -1) return undefined;
  const below = lines.slice(question + 1, question + 1 + DIALOG_ROWS);
  const footerAt = below.findIndex((line) => PERMISSION_FOOTER.test(line));
  if (footerAt === -1) return undefined;
  const rows = optionRows(below.slice(0, footerAt)).flatMap((row) => {
    const keyed = KEYED.exec(row.label);
    return keyed?.[1] === undefined || keyed[2] === undefined ? [] : [{ ...row, label: keyed[1], key: keyed[2] }];
  });
  if (rows.length === 0) return undefined;

  const firstOption = below.findIndex((line) => optionRow(line) !== undefined);
  const details = below
    .slice(0, firstOption)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const commandAt = details.findIndex((line) => line.startsWith("$ "));
  const asked = PERMISSION_QUESTION.exec(lines[question] ?? "")?.[1] ?? "";
  const destination = details.map((line) => DESTINATION.exec(line)?.[1]).find((path) => path !== undefined);
  const command = commandAt !== -1 ? details.slice(commandAt).join("\n").replace(/^\$ /, "") : (destination ?? asked);
  const block = [
    lines[question]?.trim() ?? "",
    ...details,
    ...rows.map((row) => `${row.number}. ${row.label} (${row.key})`),
    below[footerAt]?.trim() ?? "",
  ].join("\n");
  const cursor = rows.find((row) => row.cursor)?.number;
  const prompt: ScreenPrompt = {
    agent: AGENT,
    kind: "permission",
    asks: /^run\b/.test(asked) ? "wants to run" : /\bedits?\b/.test(asked) ? "wants to edit" : "asks for permission",
    question: (lines[question] ?? "").trim(),
    command,
    body: bodyText(details.filter((line, index) => (commandAt === -1 || index < commandAt) && !DESTINATION.test(line))),
    context: contextAbove(lines, question, ASKED),
    files: destination === undefined ? [] : [destination],
    multi: false,
    options: rows.map((row): PromptOption => ({
      id: row.number,
      label: row.label,
      keys: [row.key],
      open: [],
      declines: row.label.startsWith("No"),
      typed: false,
    })),
    cancel: { key: "esc", label: "Cancel" },
    ...(cursor === undefined ? {} : { cursor }),
    block,
  };
  return { prompt, top: question };
}

/**
 * Codex's question dialog (request_user_input, Plan mode), as 0.167.0 draws it:
 *
 *       Question 1/2 (2 unanswered)
 *       Which runtime should the service use?
 *       › 1. Bun (Recommended)  Bun 1.4
 *         2. Node               Node 24
 *         3. None of the above  Optionally, add details in notes (tab)
 *       tab to add notes | enter to submit answer | ←/→ to navigate questions | esc to interrupt
 *
 * A number answers the question and moves to the next. "None of the above" takes typed notes: the cursor is moved to
 * it with ↓, and Tab opens the notes.
 */
function readQuestion(lines: readonly string[]): Found | undefined {
  const counterAt = lastIndex(lines, (line) => QUESTION_COUNTER.test(line));
  if (counterAt === -1) return undefined;
  const counter = QUESTION_COUNTER.exec(lines[counterAt] ?? "");
  const dialog = lines.slice(counterAt + 1);
  const footerAt = dialog.findIndex((line) => QUESTION_FOOTER.test(line));
  const firstRow = dialog.findIndex((line) => optionRow(line) !== undefined);
  if (footerAt === -1 || firstRow === -1 || firstRow > footerAt) return undefined;
  const question = dialog
    .slice(0, firstRow)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  const rows = dialog.slice(firstRow, footerAt).flatMap((line) => {
    const row = optionRow(line);
    return row === undefined ? [] : [row];
  });
  if (question === "" || rows.length === 0) return undefined;
  const options = rows.map((row): PromptOption => {
    const split = LABEL_DETAIL.exec(row.label);
    const label = split?.[1] ?? row.label;
    const detail = split?.[2];
    const typed = detail !== undefined && NOTES.test(detail);
    return {
      id: row.number,
      label,
      ...(detail === undefined ? {} : { detail }),
      keys: typed ? [] : [row.number],
      open: typed ? ["tab"] : [],
      declines: false,
      typed,
    };
  });
  const index = Number(counter?.[1] ?? "1");
  const count = Number(counter?.[2] ?? "1");
  const footer = (dialog[footerAt] ?? "").trim();
  const cursor = rows.find((row) => row.cursor)?.number;
  const prompt: ScreenPrompt = {
    agent: AGENT,
    kind: "question",
    asks: "asks a question",
    question,
    command: question,
    body: "",
    context: contextAbove(lines, counterAt, ASKED),
    files: [],
    multi: false,
    options,
    ...(INTERRUPT.test(footer) ? { cancel: { key: "esc", label: "Interrupt" } } : {}),
    ...(count >= 2 ? { step: { index, count, titles: [] } } : {}),
    ...(cursor === undefined ? {} : { cursor }),
    typing: dialog.slice(firstRow, footerAt).some((line) => NOTES_OPEN.test(line)),
    block: [`Question ${index}/${count}`, question, ...options.map((row) => `${row.id}. ${row.label}`), footer].join(
      "\n",
    ),
  };
  return { prompt, top: counterAt };
}

/**
 * Whichever of Codex's dialogs is up. The live dialog is the one drawn lowest on the screen: a line of the agent's own
 * text above it that looks like another dialog never outranks it.
 */
export function readCodexPrompt(lines: readonly string[]): ScreenPrompt | undefined {
  const found = [readQuestion(lines), readPermission(lines)].filter((each) => each !== undefined);
  return found.reduce<Found | undefined>(
    (low, each) => (low === undefined || each.top > low.top ? each : low),
    undefined,
  )?.prompt;
}
