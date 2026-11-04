import { Button, Notice } from "@doriface/ui";
import { type AnswerPhase, dismissPromptAnswer, usePromptAnswer } from "./prompt-answer.ts";

const SHOWN: Readonly<Record<AnswerPhase, { tone: "info" | "warning" | "error"; title: string; body: string }>> = {
  waiting: { tone: "info", title: "Allow is waiting", body: "It is sent once this window is on screen." },
  sending: { tone: "info", title: "Allowing", body: "Checking the prompt is still on screen, then answering it." },
  answered: { tone: "info", title: "Allowed", body: "The agent got your answer." },
  stale: {
    tone: "warning",
    title: "Nothing was sent",
    body: "The prompt was already answered or has changed. Answer it in the terminal.",
  },
  failed: {
    tone: "error",
    title: "Nothing was sent",
    body: "Your host could not be reached. Answer it in the terminal.",
  },
};

/** The state of an Allow tapped on a notification, over the workspace until it is dismissed. */
export function PromptAnswerBanner() {
  const answer = usePromptAnswer();
  if (answer === null) return null;
  const shown = SHOWN[answer.phase];
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex justify-center px-4">
      <div
        // The notice's tints are translucent; over a live terminal the banner needs its own opaque surface.
        className="pointer-events-auto w-full max-w-md rounded-lg bg-background shadow-lg"
        data-prompt-answer={answer.phase}
        data-prompt-terminal={answer.terminal}
      >
        <Notice
          tone={shown.tone}
          title={shown.title}
          actions={
            answer.phase === "waiting" || answer.phase === "sending" ? null : (
              <Button size="sm" onClick={dismissPromptAnswer}>
                Dismiss
              </Button>
            )
          }
        >
          {shown.body}
        </Notice>
      </div>
    </div>
  );
}
