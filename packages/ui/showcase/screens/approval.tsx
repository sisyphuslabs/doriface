import { ApprovalBanner, type ApprovalBannerState, type ApprovalPrompt, type TerminalLine } from "../../src/index.ts";
import {
  APPROVAL_PROMPT,
  CLAUDE_ALLOWED_LINES,
  CLAUDE_PERMISSION_LINES,
  CLAUDE_PROMPT_GONE_LINES,
  EDIT_PROMPT,
  MULTI_PROMPT,
  PLAN_PROMPT,
  QUESTION_PROMPT,
} from "../data.ts";
import { BoardFrame, StateSection, TerminalCrop } from "./frames.tsx";
import { MobileTerminal } from "./mobile.tsx";
import { Sidebar, WorkspaceBody } from "./shell.tsx";

const STATES: readonly {
  readonly label: string;
  readonly prompt: ApprovalPrompt;
  readonly state: ApprovalBannerState;
  readonly lines: readonly TerminalLine[];
}[] = [
  {
    label: "Permission: every row of the dialog",
    prompt: APPROVAL_PROMPT,
    state: { kind: "waiting" },
    lines: CLAUDE_PERMISSION_LINES,
  },
  {
    label: "Question: one of several steps, with a typed answer",
    prompt: QUESTION_PROMPT,
    state: { kind: "waiting" },
    lines: CLAUDE_PERMISSION_LINES,
  },
  { label: "Multi-select question", prompt: MULTI_PROMPT, state: { kind: "waiting" }, lines: CLAUDE_PERMISSION_LINES },
  {
    label: "Edit: the file and its diff",
    prompt: EDIT_PROMPT,
    state: { kind: "waiting" },
    lines: CLAUDE_PERMISSION_LINES,
  },
  { label: "Plan to approve", prompt: PLAN_PROMPT, state: { kind: "waiting" }, lines: CLAUDE_PERMISSION_LINES },
  {
    label: "Sending: Yes pressed, checking the live screen first",
    prompt: APPROVAL_PROMPT,
    state: { kind: "sending", choice: { kind: "option", option: "1" } },
    lines: CLAUDE_PERMISSION_LINES,
  },
  {
    label: "Stale: the prompt went away, nothing sent",
    prompt: APPROVAL_PROMPT,
    state: { kind: "stale" },
    lines: CLAUDE_PROMPT_GONE_LINES,
  },
  {
    label: "Answered (on another device)",
    prompt: APPROVAL_PROMPT,
    state: { kind: "answered", label: "Yes", declined: false, where: "from iPhone" },
    lines: CLAUDE_ALLOWED_LINES,
  },
];

const banner = (prompt: ApprovalPrompt, state: ApprovalBannerState) => (
  <ApprovalBanner
    prompt={prompt}
    state={state}
    cwd="~/api-server"
    onOpenFile={() => undefined}
    canOpenFile={(path) => !path.startsWith("~")}
  />
);

/** #192, #669: the card pinned over the terminal, for every prompt shape and in every state. */
export function ApprovalScreen() {
  return (
    <main className="min-h-dvh bg-background">
      <div data-density="coarse" className="h-[844px] md:hidden">
        <MobileTerminal lines={CLAUDE_PERMISSION_LINES} overlay={banner(QUESTION_PROMPT, { kind: "waiting" })} />
      </div>
      <div data-density="coarse" className="md:hidden">
        {STATES.filter((entry) => entry.prompt !== QUESTION_PROMPT).map((entry) => (
          <StateSection key={entry.label} label={entry.label}>
            <TerminalCrop lines={entry.lines} overlay={banner(entry.prompt, entry.state)} className="h-[30rem]" />
          </StateSection>
        ))}
      </div>
      <div className="hidden h-[900px] md:flex">
        <Sidebar />
        <WorkspaceBody
          claudeLines={CLAUDE_PERMISSION_LINES}
          claude={{ overlay: banner(APPROVAL_PROMPT, { kind: "waiting" }) }}
        />
      </div>
      <div className="hidden grid-cols-2 gap-6 border-t border-border p-8 md:grid">
        {STATES.map((entry) => (
          <BoardFrame key={entry.label} label={entry.label}>
            <TerminalCrop lines={entry.lines} overlay={banner(entry.prompt, entry.state)} className="h-[30rem]" />
          </BoardFrame>
        ))}
      </div>
    </main>
  );
}
