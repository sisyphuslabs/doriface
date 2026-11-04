import type { HcConnection } from "@doriface/client";
import { cn } from "@doriface/ui";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
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
}

/**
 * A terminal card. A tab's only pane has no title bar: its tab names it, the status bar says where it runs, and the
 * tab strip carries its session actions. Inside a split each pane gets a slim header naming its terminal, as herdr-app
 * frames panes only once a tab is split, since the tab can name only one of them.
 */
export function Pane({ connection, terminal, focused, split, onFocus, onEnd }: PaneProps) {
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  return (
    <section
      aria-label={`${title} terminal`}
      onFocusCapture={(event) => {
        // wterm takes focus as it starts; that is not the person picking this pane (see TerminalView's attach).
        if (event.target instanceof Element && event.target.closest('[data-ready="false"]') !== null) return;
        onFocus();
      }}
      data-split={split}
      data-focused={focused}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
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
