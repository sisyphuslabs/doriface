import type { HcConnection } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { ExtraKeysBar, IconButton, ScrollArea, StatusBar, StatusBarItem, StatusChip } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Monitor, Plus, Search, Settings } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { NEW_TAB } from "../keys/actions.ts";
import { applyModifiers, keySequence, MODIFIERS } from "../terminal/keys.ts";
import { closesTab } from "../terminal/terminal-end.ts";
import { type TerminalInput, TerminalView } from "../terminal/terminal-view.tsx";
import { AgentLists } from "./agent-lists.tsx";
import { onlyThisMachine } from "./machines.ts";
import { agentStatus, terminalTitle } from "./model.ts";
import { ReconnectStatus } from "./reconnect-status.tsx";
import { PhoneEmpty } from "./phone-empty.tsx";
import { RovingLists } from "./roving-lists.tsx";
import { usePhoneActions, type SessionVerb } from "./use-app-actions.ts";
import { useMachinesContext } from "./use-machines.ts";

export interface PhoneShellProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Terminal[];
  readonly open: string | null;
  readonly onOpen: (address: string) => void;
  readonly onBack: () => void;
  readonly onNew: () => void;
  readonly onPalette: () => void;
  readonly onSession: SessionVerb;
}

/** Phones: the agents list first; opening one shows its terminal full screen with extra keys. */
export function PhoneShell(props: PhoneShellProps) {
  const { connection, terminals, open, onOpen, onBack, onNew, onPalette, onSession } = props;
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
  return <PhoneTerminal connection={connection} terminal={terminal} onBack={onBack} />;
}

function PhoneTerminal(props: {
  readonly connection: HcConnection;
  readonly terminal: Terminal;
  readonly onBack: () => void;
}) {
  const { connection, terminal, onBack } = props;
  const send = useRef<((data: TerminalInput) => void) | null>(null);
  const [latched, setLatched] = useState<ReadonlySet<string>>(new Set());
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

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-card">
      <header
        data-titlebar
        className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-chrome pt-[env(safe-area-inset-top)] pr-1.5 pl-[var(--titlebar-inset-start,0.375rem)]"
      >
        <IconButton label="Back to agents" icon={<ChevronLeft />} size="md" onClick={onBack} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 title={title} className="min-w-0 truncate text-base font-semibold text-foreground">
            {title}
          </h1>
          <StatusChip status={agentStatus(terminal)} />
        </div>
      </header>
      <TerminalView
        key={terminal.pid ?? undefined}
        connection={connection}
        address={terminal.address}
        pid={terminal.pid ?? null}
        live={terminal.state === "live"}
        focused
        label={`${title} output`}
        transformInput={transform}
        onSend={onSend}
        onEnd={(_address, end) => (closesTab(end) ? onBack() : undefined)}
      />
      <ExtraKeysBar latched={[...latched]} onKey={press} className="pb-[max(0.25rem,env(safe-area-inset-bottom))]" />
    </div>
  );
}
