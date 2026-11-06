/** How far an agent's own todo list has got: `done` of `total` items. */
export interface TodoProgress {
  readonly done: number;
  readonly total: number;
}

type TodoReader = (lines: readonly string[]) => TodoProgress | undefined;

/** A task row of Claude Code's list (✔ done, ◼ in progress, ◻ open), the first one hung off the spinner by `⎿`. */
const CLAUDE_ROW = /^\s*(?:⎿\s+)?([✔◼◻])\s+\S/u;
/** The line a long list folds into: `… +1 in progress, 6 pending`. */
const CLAUDE_FOLD = /^\s*…\s*\+(.+)$/u;
/** The count line over the list once the turn is over: `4 tasks (2 done, 1 in progress, 1 open)`. */
const CLAUDE_COUNT = /^\s*(\d+) tasks? \((\d+) done\b/u;
const DONE_WORDS = /^(?:completed|done)$/u;

/** The folded line's counts: every number toward the total, the done ones toward done. */
function foldCounts(fold: string): TodoProgress {
  let done = 0;
  let total = 0;
  for (const part of fold.split(",")) {
    const match = /(\d+)\s+(.+)/u.exec(part.trim().replace(/^\+/u, ""));
    if (match === null) continue;
    const count = Number(match[1]);
    total += count;
    if (DONE_WORDS.test((match[2] ?? "").trim())) done += count;
  }
  return { done, total };
}

/**
 * Claude Code's task list (TaskCreate and TaskUpdate), the last one on the screen: its count line when it has one, else
 * its rows plus the line the rest folds into. An AskUserQuestion tab row (`←  ☐ Runtime  ✔ Submit  →`) is not a row.
 */
const readClaudeTodos: TodoReader = (lines) => {
  let end = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (CLAUDE_ROW.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  if (end === -1) return undefined;
  let start = end;
  while (start > 0 && CLAUDE_ROW.test(lines[start - 1] ?? "")) start -= 1;
  const count = CLAUDE_COUNT.exec(lines[start - 1] ?? "");
  if (count !== null) return { done: Number(count[2]), total: Number(count[1]) };
  const rows = lines.slice(start, end + 1).map((line) => CLAUDE_ROW.exec(line)?.[1]);
  const fold = CLAUDE_FOLD.exec(lines[end + 1] ?? "");
  const folded = fold === null ? { done: 0, total: 0 } : foldCounts(fold[1] ?? "");
  return {
    done: rows.filter((mark) => mark === "✔").length + folded.done,
    total: rows.length + folded.total,
  };
};

/** Readers by the `app` an agent names itself in its OSC 7501 record; another agent has no list here. */
const READERS: Readonly<Record<string, TodoReader>> = {
  "claude-code": readClaudeTodos,
};

/** Whether the agent that reported `app` draws a todo list this reads. */
export const readsTodos = (app: string): boolean => Object.hasOwn(READERS, app);

/** The agent's todo list on a `terminal.read` screen, read by the reader of the agent that reported `app`, or nothing. */
export function readTodoProgress(app: string, screen: string): TodoProgress | undefined {
  const reader = Object.hasOwn(READERS, app) ? READERS[app] : undefined;
  return reader?.(screen.split("\n").map((line) => line.trimEnd()));
}
