import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { Button, Dialog, Notice } from "@doriface/ui";
import { useEffect, useRef, useState } from "react";
import { terminalInput } from "./focus-targets.ts";
import { terminalTitle } from "./model.ts";
import { RenameDialog } from "./rename-dialog.tsx";
import { endSession, renameSession, sessionCalls } from "./session-actions.ts";
import type { SessionAsk } from "./session-context.ts";

export interface SessionDialogsProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Terminal[];
  readonly ask: SessionAsk | null;
  readonly onDone: () => void;
  /** Hides the tab and leaves the program running. */
  readonly onKeep: (address: string) => void;
}

const COPY = {
  end: "The program stops and its output is gone. This cannot be undone.",
  close: "Keep it running and reopen it from the sidebar any time, or end the program now.",
} as const;

const ENDED = {
  rename: "It ended before you answered, so there is nothing to rename.",
  end: "It ended before you answered, so there is nothing to end.",
  close: "It ended before you answered, so there is nothing to keep running or end.",
} as const;

/**
 * The rename, end and close-tab questions for one session. A session that ends while its question is open turns the
 * question into a statement that it ended, with only OK: the question never disappears on its own, and nothing is
 * answered for the user. A question asked about a session that had already ended needs no answer and closes.
 */
export function SessionDialogs({ connection, terminals, ask, onDone, onKeep }: SessionDialogsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminal = ask === null ? undefined : terminals.find((entry) => entry.address === ask.address);
  const live = terminal?.state === "live";
  const current = terminal === undefined ? null : terminalTitle(terminal);
  // Read while the question renders, before it takes focus: the element it gives focus back to when it closes, and the
  // name it asks with. The title can change before the session ends (a rename, or the shell's name giving way to its
  // argv as it exits), and the question and its statement name what was asked about.
  const [asked, setAsked] = useState<{
    readonly ask: SessionAsk | null;
    readonly opener: Element | null;
    readonly name: string | null;
  }>({ ask: null, opener: null, name: null });
  if (asked.ask !== ask) setAsked({ ask, opener: document.activeElement, name: current });
  // A session that stops meanwhile needs no answer and gets a statement instead (below), except that a question whose
  // action is still running stays up until it settles, and one whose action failed stays up to say why, even if the
  // session left the list (a reconnect lists live terminals only), so the user can try again.
  const keep = busy || error !== null;
  // The question that has seen its session live: when that session ends, the user is told rather than left wondering.
  const [liveAsk, setLiveAsk] = useState<SessionAsk | null>(null);
  useEffect(() => {
    if (live) setLiveAsk(ask);
  }, [ask, live]);
  const ended = ask !== null && ask === liveAsk && !live && !keep;
  // The answers it replaces are gone from under the pointer and the keyboard, so OK takes focus.
  const acknowledge = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ended) acknowledge.current?.focus();
  }, [ended]);
  useEffect(() => {
    if (ask === null || keep || live) return;
    // The closed tab's session is gone either way; dropping its tab is tidying up, not an answer.
    if (ask.kind === "close") onKeep(ask.address);
    if (ask !== liveAsk) onDone();
  }, [ask, keep, live, liveAsk, onDone, onKeep]);
  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [ask]);
  if (ask === null || !(live || keep || ended)) return null;
  const title = (asked.ask === ask ? asked.name : null) ?? current ?? "";
  // Asked with focus on the page body (a terminal whose renderer had not started yet), or from an element that is gone
  // by now, the question gives focus to the focused pane's terminal instead of leaving keys with nowhere to go.
  const { opener } = asked;
  const backTo = (): HTMLElement | true =>
    opener instanceof HTMLElement && opener !== document.body && opener.isConnected ? true : (terminalInput() ?? true);
  if (ended) {
    return (
      <Dialog
        alert
        open
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        finalFocus={backTo}
        title={`${title} already ended`}
        description={ENDED[ask.kind]}
        actions={
          <Button ref={acknowledge} variant="primary" onClick={onDone}>
            OK
          </Button>
        }
      />
    );
  }
  const run = (work: () => Promise<void>, after: () => void): void => {
    setBusy(true);
    work().then(
      () => after(),
      (cause: unknown) => {
        setBusy(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  };
  const end = (): void => run(() => endSession(sessionCalls(connection), ask.address), onDone);
  if (ask.kind === "rename") {
    return (
      <RenameDialog
        title={title}
        busy={busy}
        error={error}
        onCancel={onDone}
        onRename={(name) => run(() => renameSession(sessionCalls(connection), ask.address, name), onDone)}
      />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      finalFocus={backTo}
      title={ask.kind === "end" ? `End ${title}?` : `Close ${title}?`}
      description={COPY[ask.kind]}
      actions={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="destructive" loading={busy} onClick={end}>
            End session
          </Button>
          {ask.kind === "close" ? (
            <Button
              variant="primary"
              onClick={() => {
                onKeep(ask.address);
                onDone();
              }}
            >
              Keep running
            </Button>
          ) : null}
        </>
      }
    >
      {error === null ? undefined : (
        <Notice tone="error" title="The session did not end">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}
