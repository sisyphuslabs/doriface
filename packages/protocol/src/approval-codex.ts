import {
  bodyText,
  contextAbove,
  type Found,
  indent,
  lastIndex,
  liveDialog,
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

const QUESTION_COUNTER = /^\s*Question (\d+)\/(\d+)\b/;
const QUESTION_FOOTER = /\benter to submit (?:answer|all)\b/;
const INTERRUPT = /\besc to interrupt\b/;
const LABEL_DETAIL = /^(.*?\S)\s{2,}(\S.*)$/;
const NOTES = /\(tab\)\s*$/;
/** The notes row Tab opens under the cursor's option: `› Add notes`. */
const NOTES_OPEN = /^\s*›\s+Add notes\b/;
/** The cell Codex draws for the command or edit it asks about, right above its approval (0.166.0, 0.167.0). */
const ASKED_CELL = /^• (?:Running|Edited) /;

/** The nearest line above `at` that starts left of `column`: the transcript cell a dialog drawn at `column` sits under. */
const edgeAbove = (lines: readonly string[], at: number, column: number) =>
  lastIndex(lines, (line) => line.trim() !== "" && indent(line) < column, at - 1);

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
 *
 * It is read from the bottom up: the footer, the option rows right above it, then the header above them. The header
 * is drawn two columns in, and so is every line of a command inside it, while the transcript above starts each cell
 * at the left edge. The dialog's title is the highest title line at the footer's column below that edge: a
 * title-shaped line in the command is below the real one (#776). The edge must be the cell Codex draws for what it
 * asks about (`• Running ...`, `• Edited ...`); under any other cell the agent's own text could sit right above the
 * dialog at its column and pass for its header, so nothing is read.
 */
function readPermission(lines: readonly string[]): Found | undefined {
  const footer = lastIndex(lines, (line) => PERMISSION_FOOTER.test(line));
  const first = lastIndex(lines, (line) => optionRow(line)?.number === "1", footer);
  if (footer === -1 || first === -1) return undefined;
  const rows = optionRows(lines.slice(first, footer)).flatMap((row) => {
    const keyed = KEYED.exec(row.label);
    return keyed?.[1] === undefined || keyed[2] === undefined ? [] : [{ ...row, label: keyed[1], key: keyed[2] }];
  });
  if (rows.length === 0) return undefined;

  const column = indent(lines[footer] ?? "");
  const edge = edgeAbove(lines, first, column);
  if (!ASKED_CELL.test(lines[edge] ?? "")) return undefined;
  const question = lines.findIndex(
    (line, index) => index > edge && index < first && indent(line) === column && PERMISSION_QUESTION.test(line),
  );
  if (question === -1) return undefined;
  const details = lines
    .slice(question + 1, first)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const commandAt = details.findIndex((line) => line.startsWith("$ "));
  const asked = PERMISSION_QUESTION.exec(lines[question] ?? "")?.[1] ?? "";
  const header = commandAt === -1 ? details : details.slice(0, commandAt);
  const destination = header.map((line) => DESTINATION.exec(line)?.[1]).find((path) => path !== undefined);
  const command = commandAt !== -1 ? details.slice(commandAt).join("\n").replace(/^\$ /, "") : (destination ?? asked);
  const block = [
    lines[question]?.trim() ?? "",
    ...details,
    ...rows.map((row) => `${row.number}. ${row.label} (${row.key})`),
    lines[footer]?.trim() ?? "",
  ].join("\n");
  const cursor = rows.find((row) => row.cursor)?.number;
  const prompt: ScreenPrompt = {
    agent: AGENT,
    kind: "permission",
    asks: /^run\b/.test(asked) ? "wants to run" : /\bedits?\b/.test(asked) ? "wants to edit" : "asks for permission",
    question: (lines[question] ?? "").trim(),
    command,
    body: bodyText(header.filter((line) => !DESTINATION.test(line))),
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
  return { prompt, end: footer };
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
 *
 * It is read from the bottom up: the footer, row 1 (the lowest above it), then the counter. The question is the
 * agent's own text and Codex draws the agent's message right above the dialog at the same column, so a counter in
 * either reads the same: with more than one counter under the transcript's left edge, nothing is read (#776).
 */
function readQuestion(lines: readonly string[]): Found | undefined {
  const footerAt = lastIndex(lines, (line) => QUESTION_FOOTER.test(line));
  const firstRow = lastIndex(lines, (line) => optionRow(line)?.number === "1", footerAt);
  if (footerAt === -1 || firstRow === -1) return undefined;
  const edge = edgeAbove(lines, firstRow, indent(lines[footerAt] ?? ""));
  const counters = lines.flatMap((line, index) =>
    index > edge && index < firstRow && QUESTION_COUNTER.test(line) ? [index] : [],
  );
  const counterAt = counters[0] ?? -1;
  if (counters.length !== 1) return undefined;
  const counter = QUESTION_COUNTER.exec(lines[counterAt] ?? "");
  const question = lines
    .slice(counterAt + 1, firstRow)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  const below = lines.slice(firstRow, footerAt);
  const rows = below.flatMap((line) => {
    const row = optionRow(line);
    return row === undefined ? [] : [row];
  });
  // Every line between row 1 and the footer is one of its rows in order, the notes Tab opened, or blank.
  const drawn = below.every((line) => line.trim() === "" || NOTES_OPEN.test(line) || optionRow(line) !== undefined);
  const ordered = rows.every((row, index) => row.number === String(index + 1));
  if (question === "" || rows.length === 0 || !drawn || !ordered) return undefined;
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
  const footer = (lines[footerAt] ?? "").trim();
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
    typing: below.some((line) => NOTES_OPEN.test(line)),
    block: [`Question ${index}/${count}`, question, ...options.map((row) => `${row.id}. ${row.label}`), footer].join(
      "\n",
    ),
  };
  return { prompt, end: footerAt };
}

/**
 * Whichever of Codex's dialogs is up: the one drawn at the bottom of the screen. The agent's own text above it, or a
 * command inside it, that looks like another dialog never stands for it.
 */
export function readCodexPrompt(lines: readonly string[]): ScreenPrompt | undefined {
  return liveDialog(lines, [readQuestion(lines), readPermission(lines)]);
}
