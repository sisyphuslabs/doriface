import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { Button, Dialog, Notice } from "@doriface/ui";
import { useEffect, useState } from "react";
import type { LayoutTab } from "./layout-model.ts";
import { endSession, sessionCalls } from "./session-actions.ts";

export interface CloseTabDialogProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Terminal[];
  readonly tab: LayoutTab;
  /** Takes the tab out of the layout; its programs keep running. */
  readonly onKeep: () => void;
  readonly onDone: () => void;
}

/** Closing a tab of several panes asks once for all of them: keep them running, or end them. */
export function CloseTabDialog({ connection, terminals, tab, onKeep, onDone }: CloseTabDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = new Set(tab.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])));
  const live = terminals.filter((terminal) => shown.has(terminal.address) && terminal.state === "live");
  const count = live.length;
  useEffect(() => {
    if (count > 0) return;
    onKeep();
    onDone();
  }, [count, onDone, onKeep]);
  if (count === 0) return null;
  const end = async (): Promise<void> => {
    setBusy(true);
    const calls = sessionCalls(connection);
    try {
      await Promise.all(live.map((terminal) => endSession(calls, terminal.address)));
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    onKeep();
    onDone();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title="Close this tab?"
      description={`Keep its ${count} sessions running and reopen them from the sidebar any time, or end them now.`}
      actions={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="destructive" loading={busy} onClick={() => void end()}>
            End {count} sessions
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onKeep();
              onDone();
            }}
          >
            Keep running
          </Button>
        </>
      }
    >
      {error === null ? undefined : (
        <Notice tone="error" title="A session did not end">
          {error}
        </Notice>
      )}
    </Dialog>
  );
}
