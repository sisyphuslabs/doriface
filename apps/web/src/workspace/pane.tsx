import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { StatusChip, cn } from "@doriface/ui";
import { SquareTerminal } from "lucide-react";
import { currentPlatform } from "../keys/trigger.ts";
import { useActionKeys } from "../keys/use-action-keys.ts";
import type { TerminalEnd } from "../terminal/terminal-end.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { MachineOffline } from "./machine-offline.tsx";
import { agentStatus, machineOf, spaceName, terminalTitle, UNREACHABLE } from "./model.ts";
import { SessionMenu } from "./session-menu.tsx";

export interface PaneProps {
  readonly connection: HcConnection;
  readonly terminal: Terminal;
  readonly focused: boolean;
  /** 1-based position among the shown panes, for the shortcut hint. */
  readonly index: number;
  /** True while two panes are shown; unfocused-split-opacity dims only those. */
  readonly split: boolean;
  readonly onFocus: (address: string) => void;
  readonly onEnd: (address: string, end: TerminalEnd) => void;
}

/** A terminal card: header with title, state and where it runs, then the live terminal. */
export function Pane({ connection, terminal, focused, index, split, onFocus, onEnd }: PaneProps) {
  const title = terminalTitle(terminal);
  const keys = useActionKeys(`tab.select:${index}`);
  // macOS writes shortcuts as joined glyphs (⌘1); elsewhere they read Ctrl+1.
  const shortcut = keys?.join(currentPlatform() === "mac" ? "" : "+");
  const where = [
    ...(machineOf(terminal.address) === undefined ? [] : [terminal.address]),
    spaceName(terminal),
    ...(shortcut === undefined ? [] : [shortcut]),
  ].join(" · ");
  const machine = machineOf(terminal.address);
  return (
    <section
      aria-label={`${title} terminal`}
      onFocusCapture={() => onFocus(terminal.address)}
      data-split={split}
      data-focused={focused}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <header
        className={cn(
          "flex h-(--pane-header-height) shrink-0 items-center gap-2 border-b border-border px-3 text-sm",
          focused ? "bg-raised text-foreground" : "text-muted-foreground",
        )}
      >
        <SquareTerminal aria-hidden className="size-3.5 shrink-0" />
        <h2 title={title} className="min-w-0 truncate font-medium">
          {title}
        </h2>
        <StatusChip status={agentStatus(terminal)} />
        <span title={where} className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
          {where}
        </span>
        <SessionMenu address={terminal.address} />
      </header>
      {terminal.state === UNREACHABLE && machine !== undefined ? (
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
