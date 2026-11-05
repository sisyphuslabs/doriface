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
  /** The space whose last tab this is: closing it closes the space, as herdr-app's `tab.close`, and always asks first. */
  readonly space?: { readonly name: string };
  /** Takes the tab out of the layout once its sessions have ended. */
  readonly onClosed: () => void;
  readonly onDone: () => void;
}

const counted = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Closing a space's last tab closes the space, as herdr-app's `space.close` asks: "Close space?", naming its tabs and
 * terminals, and Close ends them. Closing a tab of several panes ends all of their programs, as in herdr-app and Ghostty. It asks once first only as
 * confirm-close-surface says (while one of them runs a program, by default); otherwise it shows only if an End fails.
 */
export function CloseTabDialog({ connection, terminals, tab, space, onClosed, onDone }: CloseTabDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = new Set(tab.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])));
  const live = terminals.filter((terminal) => shown.has(terminal.address) && terminal.state === "live");
  const count = live.length;
  const asks = asksBeforeClosing(single(useTerminalConfig(), "confirm-close-surface"), live);
  const quiet = space === undefined && !asks;
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
    if (count === 0 && space === undefined) {
      onClosed();
      onDone();
      return;
    }
    if (!quiet || endedQuietly.current) return;
    endedQuietly.current = true;
    void end();
  });
  if ((count === 0 && space === undefined) || (quiet && error === null)) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title={space === undefined ? "Close this tab?" : "Close space?"}
      description={
        space !== undefined
          ? `${space.name} \u2014 ${counted(1, "tab")}, ${counted(shown.size, "terminal")}`
          : count === 1
            ? "The running program will end."
            : `Its ${count} sessions will end.`
      }
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
