import type { HcConnection } from "@doriface/client";
import { cn } from "@doriface/ui";
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
  /** True when the tab holds more than one pane: unfocused-split-opacity dims only those, and each gets a header. */
  readonly split: boolean;
  readonly onFocus: () => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
  /** The view showed that its program had already ended when it attached: there is no terminal left to type into. */
  readonly onEnded: (address: string, pid: number | null) => void;
  /** The view's input path, for input from outside the pane (dictation); null once the view unmounts. */
  readonly onPort: (port: TerminalPort | null) => void;
  /** Docked under the terminal, inside the card: the voice strip while this pane is dictated into. */
  readonly dock?: ReactNode;
}

/**
 * A terminal card. A tab's only pane has no title bar: its tab names it, the status bar says where it runs, and the
 * tab strip carries its session actions. Inside a split each pane gets a slim header naming its terminal, as herdr-app
 * frames panes only once a tab is split, since the tab can name only one of them.
 */
export function Pane({ connection, terminal, focused, split, onFocus, onEnd, onEnded, onPort, dock }: PaneProps) {
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  return (
    <section
      aria-label={`${title} terminal`}
      onFocusCapture={(event) => {
        // wterm takes focus as it starts; that is not the person picking this pane (see TerminalView's onFocus).
        if (event.target instanceof Element && event.target.closest('[data-ready="false"]') !== null) return;
        onFocus();
      }}
      data-split={split}
      data-focused={focused}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      {split ? (
        <header
          className={cn(
            "flex h-6 shrink-0 items-center border-b border-border px-2.5 text-xs",
            focused ? "bg-raised text-foreground" : "text-muted-foreground",
          )}
        >
          <h2 title={title} className="min-w-0 truncate">
            {title}
          </h2>
        </header>
      ) : null}
      {/* The terminal's own box: the approval banner pins to its top, under a split pane's header, never over it. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
            onEnded={() => onEnded(terminal.address, terminal.pid ?? null)}
            onPort={onPort}
          />
        )}
      </div>
      {dock}
    </section>
  );
}
