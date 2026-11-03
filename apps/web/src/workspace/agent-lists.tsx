import type { Terminal } from "@doriface/protocol";
import { AgentRow, SidebarSection, SpaceRow, cn, type Agent } from "@doriface/ui";
import { useMemo } from "react";
import { useNow } from "./use-now.ts";
import { MachineList } from "./machine-list.tsx";
import { showMachines } from "./machines.ts";
import { firstInSpace, groupAgents, machineId, spaceId, toSpaces } from "./model.ts";
import { useMachinesContext } from "./use-machines.ts";

export interface AgentListsProps {
  readonly terminals: readonly Terminal[];
  readonly active: string | null;
  readonly onOpen: (address: string) => void;
  /** Phones list agents before spaces. */
  readonly agentsFirst?: boolean;
}

const SECTIONS = [
  { key: "blocked", title: "Needs you", tone: "text-status-blocked-text" },
  { key: "done", title: "Done", tone: "text-status-done-text" },
  { key: "working", title: "Working", tone: "text-status-working-text" },
  { key: "idle", title: "Idle", tone: undefined },
] as const;

/** Spaces and the agent sections, shared by the desktop sidebar and the phone's first screen. */
export function AgentLists({ terminals, active, onOpen, agentsFirst = false }: AgentListsProps) {
  const now = useNow();
  const groups = useMemo(() => groupAgents(terminals, now), [terminals, now]);
  const spaces = useMemo(() => toSpaces(terminals), [terminals]);
  const activeTerminal = terminals.find((terminal) => terminal.address === active);
  const activeSpace = activeTerminal === undefined ? undefined : spaceId(activeTerminal);
  const machines = useMachinesContext();
  const activeMachine = active === null ? undefined : machineId(active);
  const openSpace = (id: string): void => {
    const address = firstInSpace(terminals, id);
    if (address !== undefined) onOpen(address);
  };
  const rows = (agents: readonly Agent[], compactBlocked: boolean) =>
    agents.map((agent) => (
      <AgentRow
        key={agent.id}
        agent={agent}
        selected={agent.id === active}
        compactBlocked={compactBlocked}
        onSelect={onOpen}
      />
    ));

  return (
    <div className="flex flex-col gap-4 px-2 pb-3">
      {showMachines(machines.entries, machines.listError) ? (
        <MachineList
          entries={machines.entries}
          activeMachine={activeMachine}
          onOpen={onOpen}
          onNewOn={machines.newTerminalOn}
          failure={machines.failure}
          listError={machines.listError}
          onDismiss={machines.dismissFailure}
          onAdd={machines.openAddMachine}
          {...(agentsFirst ? { className: "order-last" } : {})}
        />
      ) : null}
      <SidebarSection title="Spaces" count={spaces.length} className={cn(agentsFirst && "order-last")}>
        {spaces.map((space) => (
          <SpaceRow key={space.id} space={space} selected={space.id === activeSpace} onSelect={openSpace} />
        ))}
      </SidebarSection>
      {SECTIONS.map(({ key, title, tone }) =>
        groups[key].length === 0 ? null : (
          <SidebarSection key={key} title={title} count={groups[key].length} {...(tone === undefined ? {} : { tone })}>
            {rows(groups[key], key === "blocked")}
          </SidebarSection>
        ),
      )}
    </div>
  );
}
