import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { StatusChip, cn } from "@doriface/ui";
import { SquareTerminal } from "lucide-react";
import { currentPlatform } from "../keys/trigger.ts";
import { useActionKeys } from "../keys/use-action-keys.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { agentStatus, machineOf, spaceName, terminalTitle } from "./model.ts";

export interface PaneProps {
  readonly connection: HcConnection;
  readonly terminal: Terminal;
  readonly focused: boolean;
  /** 1-based position among the shown panes, for the shortcut hint. */
  readonly index: number;
  /** True while two panes are shown; unfocused-split-opacity dims only those. */
  readonly split: boolean;
  readonly onFocus: (address: string) => void;
  readonly onClosed: (address: string) => void;
}

/** A terminal card: header with title, state and where it runs, then the live terminal. */
export function Pane({ connection, terminal, focused, index, split, onFocus, onClosed }: PaneProps) {
  const title = terminalTitle(terminal);
  const keys = useActionKeys(`tab.select:${index}`);
  // macOS writes shortcuts as joined glyphs (⌘1); elsewhere they read Ctrl+1.
  const shortcut = keys?.join(currentPlatform() === "mac" ? "" : "+");
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
        <h2 className="truncate font-medium">{title}</h2>
        <StatusChip status={agentStatus(terminal)} />
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {machineOf(terminal.address) === undefined ? "" : `${terminal.address} · `}
          {shortcut === undefined ? spaceName(terminal) : `${spaceName(terminal)} · ${shortcut}`}
        </span>
      </header>
      <TerminalView
        connection={connection}
        address={terminal.address}
        focused={focused}
        label={`${title} output`}
        onClosed={onClosed}
      />
    </section>
  );
}
