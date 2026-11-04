import type { HcConnection } from "@doriface/client";
import type { ReactNode } from "react";
import { ApprovalOverlay } from "../approval/approval-overlay.tsx";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
import type { TerminalPort } from "../terminal/terminal-port.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { MachineOffline } from "./machine-offline.tsx";
import { machineOf, type Session, terminalTitle } from "./model.ts";

export interface PaneProps {
  readonly connection: HcConnection;
  readonly terminal: Session;
  readonly focused: boolean;
  /** True while two panes are shown; unfocused-split-opacity dims only those. */
  readonly split: boolean;
  readonly onFocus: (address: string) => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  /** The view's input path, for input from outside the pane (dictation); null once the view unmounts. */
  readonly onPort: (port: TerminalPort | null) => void;
  /** Docked under the terminal, inside the card: the voice strip while this pane is dictated into. */
  readonly dock?: ReactNode;
}

/**
 * A terminal card with no title bar: its tab names it, the status bar says where it runs, and the tab strip
 * carries its session actions (each shown pane is its own tab, so a header would repeat the tab).
 */
export function Pane({ connection, terminal, focused, split, onFocus, onEnd, onPort, dock }: PaneProps) {
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  return (
    <section
      aria-label={`${title} terminal`}
      onFocusCapture={() => onFocus(terminal.address)}
      data-split={split}
      data-focused={focused}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      {terminal.offline === true ? null : <ApprovalOverlay connection={connection} terminal={terminal} />}
      {terminal.offline === true && machine !== undefined ? (
        <MachineOffline machine={machine} />
      ) : (
        // A restarted program (a kept terminal's loss) has a new pid: its view attaches to it afresh.
        <TerminalView
          key={terminal.pid ?? undefined}
          connection={connection}
          address={terminal.address}
          pid={terminal.pid ?? null}
          live={terminal.state === "live"}
          focused={focused}
          label={`${title} output`}
          onEnd={onEnd}
          onPort={onPort}
        />
      )}
      {dock}
    </section>
  );
}
