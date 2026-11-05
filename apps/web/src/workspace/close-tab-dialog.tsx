import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { Button, Dialog, Notice } from "@doriface/ui";
import { useEffect, useRef, useState } from "react";
import { useTerminalConfig } from "../ghostty/config-store.ts";
import { single } from "../ghostty/config.ts";
import type { LayoutTab } from "./layout-model.ts";
import { asksBeforeClosing } from "./model.ts";
import { endSession, sessionCalls } from "./session-actions.ts";

export interface CloseTabDialogProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Terminal[];
  readonly tab: LayoutTab;
  /** Takes the tab out of the layout once its sessions have ended. */
  readonly onClosed: () => void;
  readonly onDone: () => void;
}

/**
 * Closing a tab of several panes ends all of their programs, as in herdr-app and Ghostty. It asks once first only as
 * confirm-close-surface says (while one of them runs a program, by default); otherwise it shows only if an End fails.
 */
export function CloseTabDialog({ connection, terminals, tab, onClosed, onDone }: CloseTabDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = new Set(tab.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])));
  const live = terminals.filter((terminal) => shown.has(terminal.address) && terminal.state === "live");
  const count = live.length;
  const quiet = !asksBeforeClosing(single(useTerminalConfig(), "confirm-close-surface"), live);
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
    onClosed();
    onDone();
  };
  const endedQuietly = useRef(false);
  useEffect(() => {
    if (count === 0) {
      onClosed();
      onDone();
      return;
    }
    if (!quiet || endedQuietly.current) return;
    endedQuietly.current = true;
    void end();
  });
  if (count === 0 || (quiet && error === null)) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title="Close this tab?"
      description={count === 1 ? "The running program will end." : `Its ${count} sessions will end.`}
      actions={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="destructive" loading={busy} onClick={() => void end()}>
            Close
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
