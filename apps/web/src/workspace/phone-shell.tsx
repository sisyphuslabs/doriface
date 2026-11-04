import type { HcConnection } from "@doriface/client";
import { ExtraKeysBar, IconButton, ScrollArea, StatusBar, StatusBarItem, StatusChip } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Monitor, Plus, Search, Settings } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { NEW_TAB } from "../keys/actions.ts";
import { applyModifiers, keySequence, MODIFIERS } from "../terminal/keys.ts";
import { closesTab } from "../terminal/terminal-end.ts";
import { type TerminalInput, TerminalView } from "../terminal/terminal-view.tsx";
import { DictateButton } from "../voice/dictate-button.tsx";
import { useDictation } from "../voice/use-dictation.ts";
import { VoiceDock } from "../voice/voice-dock.tsx";
import { AgentLists } from "./agent-lists.tsx";
import { MachineOffline } from "./machine-offline.tsx";
import { onlyThisMachine } from "./machines.ts";
import { agentStatus, machineOf, type Session, spaceName, terminalTitle } from "./model.ts";
import { ConnectionLine, ReconnectStatus } from "./reconnect-status.tsx";
import { PhoneEmpty } from "./phone-empty.tsx";
import { RovingLists } from "./roving-lists.tsx";
import { afterEnd } from "./session-actions.ts";
import { SessionMenu } from "./session-menu.tsx";
import { usePhoneActions, type SessionVerb } from "./use-app-actions.ts";
import { useMachinesContext } from "./use-machines.ts";

export interface PhoneShellProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Session[];
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
  // The open terminal registers its dictation here, so the palette and a bound key reach it from this shell's handler.
  const dictate = useRef<(() => void) | null>(null);
  usePhoneActions(onNew, onSession, () => (dictate.current === null ? false : (dictate.current(), true)));
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
  return <PhoneTerminal connection={connection} terminal={terminal} onBack={onBack} dictate={dictate} />;
}

function PhoneTerminal(props: {
  readonly connection: HcConnection;
  readonly terminal: Session;
  readonly onBack: () => void;
  readonly dictate: RefObject<(() => void) | null>;
}) {
  const { connection, terminal, onBack, dictate } = props;
  const send = useRef<((data: TerminalInput) => void) | null>(null);
  const voice = useDictation();
  const mic = useRef<HTMLButtonElement>(null);
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
  const machine = machineOf(terminal.address);
  const where = machine === undefined ? spaceName(terminal) : `${machine} · ${spaceName(terminal)}`;
  const offline = terminal.offline === true && machine !== undefined;
  const { toggle } = voice;
  useEffect(() => {
    dictate.current = offline ? null : toggle;
    return () => {
      dictate.current = null;
    };
  }, [dictate, offline, toggle]);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-card">
      <header
        data-titlebar
        className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border bg-chrome pt-[env(safe-area-inset-top)] pr-1.5 pl-[var(--titlebar-inset-start,0.375rem)]"
      >
        <IconButton label="Back to agents" icon={<ChevronLeft />} size="md" onClick={onBack} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <h1 title={title} className="min-w-0 truncate text-base leading-tight font-semibold text-foreground">
              {title}
            </h1>
            <StatusChip status={agentStatus(terminal)} />
          </div>
          <p title={where} className="truncate text-xs leading-tight text-muted-foreground">
            {where}
          </p>
        </div>
        {offline ? null : <DictateButton voice={voice} target={title} ref={mic} />}
        <SessionMenu address={terminal.address} title={title} placement="header" />
      </header>
      <ConnectionLine />
      {offline ? (
        <MachineOffline machine={machine} />
      ) : (
        <TerminalView
          // A rename moves the address, a restarted program changes the pid: either way the view attaches afresh.
          key={`${terminal.address}#${terminal.pid ?? ""}`}
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
        />
      )}
      {voice.state.kind === "idle" || offline ? (
        <ExtraKeysBar latched={[...latched]} onKey={press} className="pb-[max(0.25rem,env(safe-area-inset-bottom))]" />
      ) : (
        // Dictation takes the key bar's place; the transcript is typed past the latched modifiers, as written.
        <VoiceDock
          voice={voice}
          target={title}
          onType={(text) => {
            send.current?.(text);
            document.querySelector<HTMLElement>("[data-terminal] textarea")?.focus();
          }}
          onClose={() => mic.current?.focus()}
          className="pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        />
      )}
    </div>
  );
}
