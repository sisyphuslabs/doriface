import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { Button, Dialog, Notice } from "@doriface/ui";
import { useEffect, useState } from "react";
import { terminalTitle } from "./model.ts";
import { RenameDialog } from "./rename-dialog.tsx";
import { endSession, renameSession } from "./session-actions.ts";
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

/** The rename, end and close-tab questions for one session; a session that stops meanwhile needs no answer. */
export function SessionDialogs({ connection, terminals, ask, onDone, onKeep }: SessionDialogsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminal = ask === null ? undefined : terminals.find((entry) => entry.address === ask.address);
  const live = terminal?.state === "live";
  useEffect(() => {
    if (ask === null || live) return;
    if (ask.kind === "close") onKeep(ask.address);
    onDone();
  }, [ask, live, onDone, onKeep]);
  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [ask]);
  if (ask === null || terminal === undefined || !live) return null;
  const title = terminalTitle(terminal);
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
  const end = (): void => run(() => endSession(connection, ask.address), onDone);
  if (ask.kind === "rename") {
    return (
      <RenameDialog
        title={title}
        busy={busy}
        error={error}
        onCancel={onDone}
        onRename={(name) => run(() => renameSession(connection, ask.address, name), onDone)}
      />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title={ask.kind === "end" ? `End ${title}?` : `Close ${title}?`}
      description={COPY[ask.kind]}
      actions={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant={ask.kind === "end" ? "destructive" : "secondary"} loading={busy} onClick={end}>
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
