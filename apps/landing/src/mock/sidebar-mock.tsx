import { AgentRow, MachineHeader, SidebarSection, SpaceRow, type Agent, type Space } from "@doriface/ui";
import type { ReactNode } from "react";

const NEEDS_YOU: readonly Agent[] = [
  { id: "deploy", name: "deploy", status: "blocked", detail: "Approve the deploy", age: "<1m" },
];

const WORKING: readonly Agent[] = [
  { id: "review", name: "review", status: "working", detail: "Reviewing the relay", machine: "build-box", age: "<1m" },
  { id: "plan", name: "plan", status: "working", detail: "terraform", machine: "build-box", age: "2m" },
];

const IDLE: readonly Agent[] = [
  { id: "shell", name: "shell", status: "idle", detail: "doriterm", age: "6m" },
  { id: "logs", name: "logs", status: "idle", detail: "infra", machine: "build-box", age: "12m" },
];

const LOCAL_SPACES: readonly Space[] = [
  { id: "website", name: "website", tabs: 2, attention: "blocked", color: "orange" },
  { id: "doriterm", name: "doriterm", tabs: 2, color: "blue" },
];

const REMOTE_SPACES: readonly Space[] = [{ id: "infra", name: "infra", tabs: 3, attention: "working", color: "green" }];

/** The agent list alone, from the app's own sections and rows: fixture data, no host. */
export function AgentsMock(): ReactNode {
  return (
    <div className="mock flex w-(--sidebar-width) flex-col gap-3 bg-sidebar p-3 text-foreground">
      <SidebarSection title="Needs you" count={NEEDS_YOU.length} tone="text-status-blocked-text">
        {NEEDS_YOU.map((agent) => (
          <AgentRow key={agent.id} agent={agent} compactBlocked />
        ))}
      </SidebarSection>
      <SidebarSection title="Working" count={WORKING.length} tone="text-status-working-text">
        {WORKING.map((agent) => (
          <AgentRow key={agent.id} agent={agent} />
        ))}
      </SidebarSection>
      <SidebarSection title="Idle" count={IDLE.length}>
        {IDLE.map((agent) => (
          <AgentRow key={agent.id} agent={agent} />
        ))}
      </SidebarSection>
    </div>
  );
}

/** The machines list alone, from the app's own machine headers and space rows: fixture data, no host. */
export function MachinesMock(): ReactNode {
  return (
    <div
      data-detect-ignore="low-contrast"
      className="mock flex w-(--sidebar-width) flex-col gap-3 bg-sidebar p-3 text-foreground"
    >
      <div>
        <MachineHeader name="studio" local state="connected" live={4} connected={false} onNewSpace={() => {}} />
        {LOCAL_SPACES.map((space) => (
          <SpaceRow key={space.id} space={space} hideMachine selected={space.id === "doriterm"} />
        ))}
      </div>
      <div>
        <MachineHeader name="build-box" local={false} state="connected" live={3} connected onNewSpace={() => {}} />
        {REMOTE_SPACES.map((space) => (
          <SpaceRow key={space.id} space={space} hideMachine />
        ))}
      </div>
    </div>
  );
}
