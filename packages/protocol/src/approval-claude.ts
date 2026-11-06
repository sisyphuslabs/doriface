import {
  bodyText,
  contextAbove,
  lastIndex,
  type OptionRow,
  optionRow,
  optionRows,
  type PromptOption,
  type PromptStep,
  type ScreenPrompt,
} from "./approval-rows.ts";

const AGENT = "Claude Code";
const CANCEL = { key: "esc", label: "Cancel" } as const;
/** The person's own message in the transcript: where the agent's lines above a dialog start. */
const ASKED = /^❯ /;
const DIALOG_TOP = /^\s*─{10,}$/;
const COMMAND_RULE = /^\s*╌{10,}$/;
const TIP = /^\s*Tip:/;

/** How far below its question line a permission dialog's footer can be: its option rows, wrapped or not. */
const DIALOG_ROWS = 16;
const PERMISSION_QUESTION = /^\s*Do you want to .+\?\s*$/;
const PERMISSION_FOOTER = /\bEsc to cancel\b/;

/** AskUserQuestion's footer, and the tab row under its top rule: `←  ☐ Runtime  ☒ Deploy  ✔ Submit  →`. */
const QUESTION_FOOTER = /^\s*Enter to select\b.*\bEsc to cancel\b/;
const TAB_ROW = /^\s*(?:←\s+)?[☐☒✔]\s/;
const TAB = /([☐☒✔])\s+(.+?)(?=\s{2,}|\s*→|$)/g;
const REVIEW = /^\s*Review your answers\s*$/;
const SUBMIT_QUESTION = /^\s*Ready to submit your answers\?\s*$/;
const TYPE_SOMETHING = /^Type something\b/;
const CHECKBOX = /^\[(.)\]\s+(.*)$/;

const PLAN_QUESTION = /Would you like to proceed\?\s*$/;
const EXIT_PLAN_QUESTION = /^\s*Exit plan mode\?\s*$/;
const PLAN_HEADING = /^\s*Here is Claude's plan:\s*$/;
const PLAN_FILE = /·\s+(\S+\.md)\s*$/;
const PLAN_TYPED = /^Tell Claude what to change\b/;

const indent = (line: string) => line.length - line.trimStart().length;

/** A dialog a reader found: its prompt and the row its top rule is on, which says how far down the screen it is. */
interface Found {
  readonly prompt: ScreenPrompt;
  readonly top: number;
}

/** The first row above `at` that is not blank, or -1. */
const aboveBlank = (lines: readonly string[], at: number) => lastIndex(lines, (line) => line.trim() !== "", at - 1);
const isNo = (label: string) => label === "No" || label.startsWith("No,");

/**
 * A question or plan dialog's option list: each numbered row, with the lines under it indented to its label as its
 * detail. Rules and lines indented less than the label (Claude's own Submit row) are not rows; a blank line ends it.
 */
function detailedRows(lines: readonly string[]): (OptionRow & { readonly detail?: string })[] {
  const rows: (OptionRow & { detail?: string })[] = [];
  /** Where each row's label starts: a line under it indented at least that far is its detail. */
  const columns: number[] = [];
  for (const line of lines) {
    const row = optionRow(line);
    const last = rows.at(-1);
    if (row !== undefined) {
      const box = CHECKBOX.exec(row.label);
      rows.push(row);
      columns.push(line.length - (box?.[2] ?? row.label).length);
    } else if (last !== undefined && line.trim() === "") break;
    else if (last === undefined || DIALOG_TOP.test(line) || indent(line) < (columns.at(-1) ?? 0)) continue;
    else last.detail = last.detail === undefined ? line.trim() : `${last.detail} ${line.trim()}`;
  }
  return rows;
}

function cursorOf(rows: readonly OptionRow[]): string | undefined {
  return rows.find((row) => row.cursor)?.number;
}

function option(row: OptionRow & { readonly detail?: string }, more: Partial<PromptOption> = {}): PromptOption {
  return {
    id: row.number,
    label: row.label,
    ...(row.detail === undefined ? {} : { detail: row.detail }),
    keys: [row.number],
    open: [],
    declines: false,
    typed: false,
    ...more,
  };
}

const rowText = (entry: PromptOption) =>
  [
    `${entry.id}. ${entry.checked === undefined ? "" : entry.checked ? "[x] " : "[ ] "}${entry.label}`,
    ...(entry.detail === undefined ? [] : [entry.detail]),
  ].join("\n");

/**
 * Claude Code's permission dialog, as 2.1.306 and 2.1.311 draw it under hc:
 *
 *     ──────────────
 *      Bash command                         Edit file / Create file
 *      Tip: ...                  (sometimes) notes.md                  (the file)
 *      Create the probe file     (the tool's description)
 *     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *      touch probe-a.txt                    the diff, or the new file's text
 *     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *      Do you want to proceed?              Do you want to make this edit to notes.md?
 *      ❯ 1. Yes
 *        2. Yes, and always allow ...
 *        3. No
 *      Esc to cancel · Tab to amend
 *
 * Each row's number picks it wherever the cursor sits (Enter would confirm the cursor's row); Esc is the dialog's cancel.
 */
function readPermission(lines: readonly string[]): Found | undefined {
  const question = lastIndex(lines, (line) => PERMISSION_QUESTION.test(line));
  if (question === -1) return undefined;
  const below = lines.slice(question + 1, question + 1 + DIALOG_ROWS);
  const footerAt = below.findIndex((line) => PERMISSION_FOOTER.test(line));
  if (footerAt === -1) return undefined;
  const rows = optionRows(below.slice(0, footerAt));
  if (rows.length === 0) return undefined;

  const top = lastIndex(lines, (line) => DIALOG_TOP.test(line), question);
  const body = lines.slice(top + 1, question);
  const words = body.filter((line) => line.trim() !== "" && !TIP.test(line) && !COMMAND_RULE.test(line));
  const header = words[0]?.trim() ?? "";
  const rules = body.flatMap((line, index) => (COMMAND_RULE.test(line) ? [index] : []));
  const between = rules.length >= 2 ? body.slice((rules[0] ?? 0) + 1, rules[1]) : [];
  const asked = lines[question]?.trim() ?? "";
  const shown = between
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
  const edit = /^(Edit|Create) file$/.exec(header);
  const file = edit === null ? undefined : words[1]?.trim();
  const command = file ?? (shown === "" ? asked.replace(/^Do you want to /, "") : shown);
  if (command === "") return undefined;
  const description = body
    .slice(0, rules[0] ?? body.length)
    .filter((line) => line.trim() !== "" && !TIP.test(line))
    .slice(1);

  const block = [
    ...body.filter((line) => !TIP.test(line)).map((line) => line.trim()),
    asked,
    ...rows.map((row) => `${row.number}. ${row.label}`),
    below[footerAt]?.trim() ?? "",
  ].join("\n");
  const cursor = cursorOf(rows);
  if (top === -1) return undefined;
  const prompt: ScreenPrompt = {
    agent: AGENT,
    kind: "permission",
    asks: /^Bash\b/.test(header)
      ? "wants to run"
      : edit?.[1] === "Edit"
        ? "wants to edit"
        : edit?.[1] === "Create"
          ? "wants to create"
          : "asks for permission",
    question: asked,
    command,
    body: bodyText(file === undefined ? description.map((line) => line.trim()) : between),
    context: contextAbove(lines, top, ASKED),
    files: file === undefined ? [] : [file],
    multi: false,
    options: rows.map((row) => option(row, { declines: isNo(row.label) })),
    cancel: CANCEL,
    ...(cursor === undefined ? {} : { cursor }),
    block,
  };
  return { prompt, top };
}

/** The tab row's questions in order, and which one is up: the first not yet answered, or Submit once all are. */
function stepOf(tabRow: string, review: boolean): PromptStep | undefined {
  const tabs = [...tabRow.matchAll(TAB)].map((match) => ({ mark: match[1] ?? "", title: (match[2] ?? "").trim() }));
  if (tabs.length < 2) return undefined;
  const open = tabs.findIndex((tab) => tab.mark === "☐");
  const index = review || open === -1 ? tabs.length : open + 1;
  return { index, count: tabs.length, titles: tabs.map((tab) => tab.title) };
}

/**
 * Claude Code's question dialog (AskUserQuestion), as 2.1.311 draws it:
 *
 *     ──────────────
 *     ←  ☐ Runtime  ☐ Deploy  ✔ Submit  →     (one tab per question; `☐ Database` alone for one question)
 *
 *     Which runtime should the service use?
 *
 *     ❯ 1. Bun                                  (`1. [ ] Lint` in a multi-select one: the number toggles the box)
 *          Bun 1.4
 *       2. Node
 *          Node 24
 *       3. Type something.                      (the cursor on it takes typed text)
 *     ──────────────
 *       4. Chat about this
 *
 *     Enter to select · Tab/Arrow keys to navigate · Esc to cancel
 *
 * A number answers its question and moves to the next one; → leaves a multi-select one for the next. Once every
 * question is answered it shows the answers under "Review your answers" and asks "Ready to submit your answers?".
 */
function readQuestion(lines: readonly string[]): Found | undefined {
  const tabAt = lastIndex(lines, (line) => TAB_ROW.test(line));
  if (tabAt < 1 || !DIALOG_TOP.test(lines[tabAt - 1] ?? "")) return undefined;
  const top = tabAt - 1;
  const dialog = lines.slice(tabAt + 1);
  const reviewAt = dialog.findIndex((line) => REVIEW.test(line));
  const review = reviewAt !== -1;
  const footerAt = dialog.findIndex((line) => QUESTION_FOOTER.test(line));
  const questionAt = review
    ? dialog.findIndex((line) => SUBMIT_QUESTION.test(line))
    : dialog.findIndex((line) => line.trim() !== "");
  if (questionAt === -1 || (!review && footerAt === -1)) return undefined;
  const firstRow = dialog.findIndex((line, index) => index > questionAt && optionRow(line) !== undefined);
  if (firstRow === -1) return undefined;
  const question = dialog
    .slice(questionAt, firstRow)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  const rows = detailedRows(dialog.slice(firstRow, footerAt === -1 ? undefined : footerAt));
  const multi = rows.some((row) => CHECKBOX.test(row.label));
  const options = rows.flatMap((row): PromptOption[] => {
    const box = CHECKBOX.exec(row.label);
    const label = box?.[2] ?? row.label;
    const typed = TYPE_SOMETHING.test(label);
    // A multi-select dialog's typed row is a box too; its text cannot be checked from outside, so it is not offered.
    if (typed && multi) return [];
    return [
      option(
        { ...row, label },
        {
          declines: review && label === "Cancel",
          typed,
          ...(box === null ? {} : { checked: box[1] !== " " }),
        },
      ),
    ];
  });
  if (options.length === 0) return undefined;
  const step = stepOf(lines[tabAt] ?? "", review);
  const footer = footerAt === -1 ? "" : (dialog[footerAt]?.trim() ?? "");
  const body = review ? bodyText(dialog.slice(reviewAt + 1, questionAt)) : "";
  const cursor = cursorOf(rows);
  const prompt: ScreenPrompt = {
    agent: AGENT,
    kind: "question",
    asks: review ? "asks to submit your answers" : "asks a question",
    question,
    command: question,
    body,
    context: contextAbove(lines, top, ASKED),
    files: [],
    multi,
    options,
    ...(multi ? { submit: "right" } : {}),
    ...(PERMISSION_FOOTER.test(footer) ? { cancel: CANCEL } : {}),
    ...(step === undefined ? {} : { step }),
    ...(cursor === undefined ? {} : { cursor, typing: options.some((row) => row.id === cursor && row.typed) }),
    block: [(lines[tabAt] ?? "").trim(), question, body, ...options.map(rowText), footer].join("\n"),
  };
  return { prompt, top };
}

/**
 * Claude Code's plan approval in plan mode, as 2.1.311 draws it:
 *
 *     ──────────────
 *      Ready to code?
 *      Here is Claude's plan:
 *     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *      Add the users migration ...         (the plan)
 *     ╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *     ──────────────
 *      Claude has written up a plan and is ready to execute. Would you like to proceed?
 *      ❯ 1. Yes, and use auto mode
 *        2. Yes, manually approve edits
 *        3. Tell Claude what to change     (the cursor on it takes typed feedback)
 *           shift+tab to approve with this feedback
 *      ctrl+g to edit in Vim · ~/.claude/plans/<name>.md
 *
 * With no plan written it asks "Exit plan mode?" with Yes and No rows instead.
 */
function readPlan(lines: readonly string[]): Found | undefined {
  // The question opens its own dialog, right under the dialog's top rule: the agent's own words saying "Would you like
  // to proceed?" anywhere else on the screen are not this dialog.
  const question = lastIndex(
    lines,
    (line, index) =>
      (PLAN_QUESTION.test(line) || EXIT_PLAN_QUESTION.test(line)) &&
      DIALOG_TOP.test(lines[aboveBlank(lines, index)] ?? ""),
  );
  if (question === -1) return undefined;
  const below = lines.slice(question + 1, question + 1 + DIALOG_ROWS);
  const rows = detailedRows(below);
  if (rows.length === 0) return undefined;
  const lastRow = below.findLastIndex((line) => optionRow(line) !== undefined);
  const footer = below.slice(lastRow + 1).find((line) => PLAN_FILE.test(line));
  const file = footer === undefined ? undefined : PLAN_FILE.exec(footer)?.[1];
  const heading = lastIndex(lines, (line) => PLAN_HEADING.test(line), question);
  const top = lastIndex(lines, (line) => DIALOG_TOP.test(line), heading === -1 ? question : heading);
  const plan = heading === -1 ? [] : lines.slice(heading + 1, question);
  const body = bodyText(plan.filter((line) => !COMMAND_RULE.test(line)).map((line) => line.trimStart()));
  const asked = (lines[question] ?? "").trim();
  const options = rows.map((row) => option(row, { declines: isNo(row.label), typed: PLAN_TYPED.test(row.label) }));
  const cursor = cursorOf(rows);
  const prompt: ScreenPrompt = {
    agent: AGENT,
    kind: "plan",
    asks: body === "" ? "wants to leave plan mode" : "has a plan ready",
    question: asked,
    command: body === "" ? asked : (body.split("\n")[0] ?? asked),
    body,
    context: contextAbove(lines, top, ASKED),
    files: file === undefined ? [] : [file],
    multi: false,
    options,
    cancel: CANCEL,
    ...(cursor === undefined ? {} : { cursor, typing: options.some((row) => row.id === cursor && row.typed) }),
    block: [body, asked, ...options.map(rowText), footer?.trim() ?? ""].join("\n"),
  };
  // A plan's dialog starts at its heading's rule ("Ready to code?" above the plan), or at the question's own rule.
  return { prompt, top: Math.max(top, aboveBlank(lines, question)) };
}

/**
 * Whichever of Claude Code's dialogs is up. The live dialog is the one drawn lowest on the screen: a line of the
 * agent's own text above it that looks like another dialog's question never outranks it, whatever kind it reads as.
 */
export function readClaudePrompt(lines: readonly string[]): ScreenPrompt | undefined {
  const found = [readQuestion(lines), readPlan(lines), readPermission(lines)].filter((each) => each !== undefined);
  return found.reduce<Found | undefined>(
    (low, each) => (low === undefined || each.top > low.top ? each : low),
    undefined,
  )?.prompt;
}
