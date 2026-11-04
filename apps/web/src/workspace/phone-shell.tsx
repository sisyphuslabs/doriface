import type { HcConnection } from "@doriface/client";
import { ExtraKeysBar, IconButton, ScrollArea, StatusBar, StatusBarItem } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Monitor, Plus, Search, Settings } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { NEW_TAB } from "../keys/actions.ts";
import { applyModifiers, keySequence, MODIFIERS } from "../terminal/keys.ts";
import { closesTab } from "../terminal/terminal-end.ts";
import { type TerminalInput, TerminalView } from "../terminal/terminal-view.tsx";
import { AgentLists } from "./agent-lists.tsx";
import { MachineOffline } from "./machine-offline.tsx";
import { onlyThisMachine } from "./machines.ts";
import { machineOf, type Session, terminalTitle } from "./model.ts";
import { PhoneHeader } from "./phone-header.tsx";
import { ConnectionLine, ReconnectStatus } from "./reconnect-status.tsx";
import { PhoneEmpty } from "./phone-empty.tsx";
import { RovingLists } from "./roving-lists.tsx";
import { afterEnd } from "./session-actions.ts";
import { usePhoneActions, type SessionVerb } from "./use-app-actions.ts";
import { useMachinesContext } from "./use-machines.ts";

export interface PhoneShellProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Session[];
  readonly open: string | null;
  /** The terminals of the tab that shows the open one, in its panes' order; one when that tab is not split. */
  readonly panes: readonly string[];
  readonly onOpen: (address: string) => void;
  readonly onBack: () => void;
  readonly onNew: () => void;
  readonly onPalette: () => void;
  readonly onSession: SessionVerb;
}

/** Phones: the agents list first; opening one shows its terminal full screen with extra keys. */
export function PhoneShell(props: PhoneShellProps) {
  const { connection, terminals, open, panes, onOpen, onBack, onNew, onPalette, onSession } = props;
  usePhoneActions(onNew, onSession);
  const machines = useMachinesContext();
  const terminal = terminals.find((entry) => entry.address === open);
  const empty = !terminals.some((entry) => entry.state === "live");
  if (terminal === undefined) {
    const route = connectionStore.settings.mode === "relay" ? "relay" : "loopback";
    return (
      <div className="flex h-dvh min-h-0 min-w-0 flex-col bg-sidebar">
        <header
          data-titlebar
          className="flex h-12 shrink-0 items-center gap-1 pt-[env(safe-area-inset-top)] pr-4 pl-[var(--titlebar-inset-start,1rem)]"
        >
          <h1 className="flex-1 text-xl font-semibold text-foreground">Agents</h1>
          <IconButton label="Command palette" icon={<Search />} size="md" onClick={onPalette} />
          <IconButton label={NEW_TAB.label} icon={<Plus />} size="md" onClick={onNew} />
          <IconButton label="Settings" icon={<Settings />} size="md" render={<Link to="/settings" />} />
        </header>
        <ScrollArea slot="agents-list" className="flex-1">
          {empty ? (
            <PhoneEmpty host={connection.hello.core.name} onNew={onNew} onAddMachine={machines.openAddMachine} />
          ) : null}
          {empty && onlyThisMachine(machines.entries) ? null : (
            <RovingLists>
              <AgentLists terminals={terminals} active={null} onOpen={onOpen} agentsFirst />
            </RovingLists>
          )}
        </ScrollArea>
        <StatusBar
          start={
            <>
              <StatusBarItem icon={<Monitor aria-hidden />}>{`${connection.hello.core.name} · ${route}`}</StatusBarItem>
              <ReconnectStatus />
            </>
          }
        />
      </div>
    );
  }
  return (
    <PhoneTerminal
      connection={connection}
      terminal={terminal}
      terminals={terminals}
      panes={panes}
      onBack={onBack}
      onOpen={onOpen}
    />
  );
}

/**
 * A phone shows one pane of a split tab at a time; this steps through the tab's panes in order, as a swipe would
 * between full-screen pages, with 44 pt targets.
 */
function PaneSwitcher(props: {
  readonly panes: readonly string[];
  readonly open: string;
  readonly onOpen: (address: string) => void;
}) {
  const { panes, open, onOpen } = props;
  const at = panes.indexOf(open);
  if (panes.length < 2 || at === -1) return null;
  const step = (by: 1 | -1): void => {
    const next = panes[(at + by + panes.length) % panes.length];
    if (next !== undefined) onOpen(next);
  };
  return (
    <nav
      aria-label="Panes in this tab"
      className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-chrome px-1.5"
    >
      <IconButton label="Previous pane" icon={<ChevronLeft />} size="md" onClick={() => step(-1)} />
      <span aria-live="polite" className="text-xs text-muted-foreground">
        Pane {at + 1} of {panes.length}
      </span>
      <IconButton label="Next pane" icon={<ChevronRight />} size="md" onClick={() => step(1)} />
    </nav>
  );
}

function PhoneTerminal(props: {
  readonly connection: HcConnection;
  readonly terminal: Session;
  readonly terminals: readonly Session[];
  readonly panes: readonly string[];
  readonly onBack: () => void;
  readonly onOpen: (address: string) => void;
}) {
  const { connection, terminal, terminals, panes, onBack, onOpen } = props;
  const send = useRef<((data: TerminalInput) => void) | null>(null);
  const [latched, setLatched] = useState<ReadonlySet<string>>(new Set());
  // A rename moves the address, a restarted program changes the pid: either way the view attaches afresh.
  const viewKey = `${terminal.address}#${terminal.pid ?? ""}`;
  // The view that showed its program had already ended; the keys bar has nothing to send to under it.
  const [endedView, setEndedView] = useState<string | null>(null);
  const onSend = useCallback((next: ((data: TerminalInput) => void) | null) => {
    send.current = next;
  }, []);
  const transform = (data: string): string => {
    if (latched.size === 0) return data;
    setLatched(new Set());
    return applyModifiers(data, latched);
  };
  const press = (id: string): void => {
    if (MODIFIERS.has(id)) {
      setLatched((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      return;
    }
    const sequence = keySequence(id);
    if (sequence !== undefined) send.current?.(transform(sequence));
  };
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-card">
      <PhoneHeader terminal={terminal} terminals={terminals} onBack={onBack} onOpen={onOpen} />
      <ConnectionLine />
      <PaneSwitcher panes={panes} open={terminal.address} onOpen={onOpen} />
      {terminal.offline === true && machine !== undefined ? (
        <MachineOffline machine={machine} />
      ) : (
        <TerminalView
          key={viewKey}
          connection={connection}
          address={terminal.address}
          pid={terminal.pid ?? null}
          live={terminal.state === "live"}
          focused
          label={`${title} output`}
          transformInput={transform}
          onSend={onSend}
          // An End of this session leaves the screen only once it has removed the terminal (see afterEnd).
          onEnd={(address, end) => (closesTab(end) ? afterEnd(address, onBack) : undefined)}
          // The header already has Back to agents; this one closes the ended session.
          closeLabel="Close"
          onEnded={() => setEndedView(viewKey)}
        />
      )}
      {endedView === viewKey ? null : (
        <ExtraKeysBar latched={[...latched]} onKey={press} className="pb-[max(0.25rem,env(safe-area-inset-bottom))]" />
      )}
    </div>
  );
}
