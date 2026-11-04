import type { HcConnection } from "@doriface/client";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
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
}

/**
 * A terminal card with no title bar: its tab names it, the status bar says where it runs, and the tab strip
 * carries its session actions (each shown pane is its own tab, so a header would repeat the tab).
 */
export function Pane({ connection, terminal, focused, split, onFocus, onEnd }: PaneProps) {
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  return (
    <section
      aria-label={`${title} terminal`}
      onFocusCapture={() => onFocus(terminal.address)}
      data-split={split}
      data-focused={focused}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
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
        />
      )}
    </section>
  );
}
