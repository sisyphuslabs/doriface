// `bun e2e/fake-permission-agent.ts <log>`: a program that asks the way Claude Code 2.1.306 does under hc. It reports
// working and then `blocked`/`kind: permission` over OSC 7501 (as `app: claude-code`), draws Claude Code's own Bash
// permission dialog (copied from a real session) to the terminal's width, and logs every key it receives to <log>:
// `1` allows, Esc declines, and `x` stands for a person answering in the terminal before the status catches up (the
// dialog goes, the status stays blocked).
import { appendFileSync } from "node:fs";
import { CLAUDE_PROMPT_SCREEN } from "../../../packages/protocol/src/testing/approval-screens.ts";

const log = process.argv[2];
if (log === undefined) throw new Error("usage: fake-permission-agent.ts <log>");

const ESC = "\u001B";
const report = (fields: string) => process.stdout.write(`${ESC}]7501;${fields}${ESC}\\`);
const lines = CLAUDE_PROMPT_SCREEN.split("\n");
const dialog = lines.slice(lines.findIndex((line) => /^─{10,}$/.test(line)));
const width = () => Math.max(20, (process.stdout.columns ?? 80) - 1);
const fit = (line: string) => (/^([─╌])\1+$/.test(line) ? (line[0] ?? "─").repeat(width()) : line.slice(0, width()));
const draw = (rows: readonly string[]) => process.stdout.write(`${ESC}[2J${ESC}[H${rows.map(fit).join("\r\n")}`);
const transcript = ["❯ Create the probe files.", "", "● Creating the probe file", "  ⎿  $ touch probe-a.txt", ""];

report("state=working:app=claude-code");
draw([...transcript, ...dialog]);
report("state=blocked:kind=permission:app=claude-code");

process.stdin.setRawMode(true);
process.stdin.on("data", (bytes: Buffer) => {
  const key = bytes.toString("utf8");
  appendFileSync(log, `${JSON.stringify(key)}\n`);
  if (key === "1") {
    draw([...transcript.slice(0, 3), "● Bash(touch probe-a.txt)", "  ⎿  Allowed", ""]);
    report("state=working:app=claude-code");
    report("state=idle:app=claude-code");
  } else if (key === ESC) {
    draw([...transcript.slice(0, 3), "  ⎿  Interrupted · What should Claude do instead?", ""]);
    report("state=idle:app=claude-code");
  } else if (key === "x") {
    draw([...transcript.slice(0, 3), "  ⎿  Answered in the terminal", ""]);
  }
});
