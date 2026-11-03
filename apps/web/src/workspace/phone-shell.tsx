import type { HcConnection, TerminalStream } from "@doriface/client";
import type { Terminal } from "@doriface/protocol";
import { ExtraKeysBar, IconButton, ScrollArea, StatusBar, StatusBarItem, StatusChip } from "@doriface/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Monitor, Plus, Search, Settings } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { applyModifiers, keySequence, MODIFIERS } from "../terminal/keys.ts";
import { TerminalView } from "../terminal/terminal-view.tsx";
import { AgentLists } from "./agent-lists.tsx";
import { agentStatus, terminalTitle } from "./model.ts";
import { usePhoneActions } from "./use-app-actions.ts";

export interface PhoneShellProps {
  readonly connection: HcConnection;
  readonly terminals: readonly Terminal[];
  readonly open: string | null;
  readonly onOpen: (address: string) => void;
  readonly onBack: () => void;
  readonly onNew: () => void;
  readonly onPalette: () => void;
}

/** Phones: the agents list first; opening one shows its terminal full screen with extra keys. */
export function PhoneShell({ connection, terminals, open, onOpen, onBack, onNew, onPalette }: PhoneShellProps) {
  usePhoneActions(onNew);
  const terminal = terminals.find((entry) => entry.address === open);
  if (terminal === undefined) {
    const route = connectionStore.settings.mode === "relay" ? "relay" : "loopback";
    return (
      <div className="flex h-dvh min-h-0 min-w-0 flex-col bg-sidebar">
        <header className="flex h-12 shrink-0 items-center gap-1 px-4 pt-[env(safe-area-inset-top)]">
          <h1 className="flex-1 text-xl font-semibold text-foreground">Agents</h1>
          <IconButton label="Command palette" icon={<Search />} size="md" onClick={onPalette} />
          <IconButton label="New terminal" icon={<Plus />} size="md" onClick={onNew} />
          <IconButton label="Settings" icon={<Settings />} size="md" render={<Link to="/settings" />} />
        </header>
        <ScrollArea slot="agents-list" className="flex-1">
          <AgentLists terminals={terminals} active={null} onOpen={onOpen} agentsFirst />
        </ScrollArea>
        <StatusBar
          start={
            <StatusBarItem icon={<Monitor aria-hidden />}>{`${connection.hello.core.name} · ${route}`}</StatusBarItem>
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
  const stream = useRef<TerminalStream | null>(null);
  const [latched, setLatched] = useState<ReadonlySet<string>>(new Set());
  const onStream = useCallback((next: TerminalStream | null) => {
    stream.current = next;
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
    if (sequence !== undefined) stream.current?.write(transform(sequence));
  };
  const title = terminalTitle(terminal);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-card">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-chrome px-1.5 pt-[env(safe-area-inset-top)]">
        <IconButton label="Back to agents" icon={<ChevronLeft />} size="md" onClick={onBack} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-base font-semibold text-foreground">{title}</h1>
          <StatusChip status={agentStatus(terminal)} />
        </div>
      </header>
      <TerminalView
        connection={connection}
        address={terminal.address}
        focused
        label={`${title} output`}
        transformInput={transform}
        onStream={onStream}
        onClosed={onBack}
      />
      <ExtraKeysBar latched={[...latched]} onKey={press} className="pb-[max(0.25rem,env(safe-area-inset-bottom))]" />
    </div>
  );
}
