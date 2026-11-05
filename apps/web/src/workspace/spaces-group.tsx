import type { Terminal } from "@doriface/protocol";
import { IconButton, MachineHeader, Notice, SidebarSection, SpaceRow, cn, type Space } from "@doriface/ui";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { machineCause } from "./machine-cause.ts";
import { stateLabel, type MachineEntry } from "./machines.ts";
import { firstInSpace, spaceId, toSpaces } from "./model.ts";
import { RetryButton } from "./retry-button.tsx";
import { machineGroups } from "./sidebar-model.ts";
import { useSpaceColors } from "./sidebar-prefs.ts";
import { useMachinesContext } from "./use-machines.ts";

export interface SpacesGroupProps {
  readonly terminals: readonly Terminal[];
  readonly active: string | null;
  readonly onOpen: (address: string) => void;
  readonly rail?: boolean;
}

const ALARM = new Set(["unreachable", "needs_login"]);

/** A machine's problem in plain words with Try again, under its header; a redial in progress gets none. */
function MachineNotice({ name }: { readonly name: string }) {
  const { views, retry } = useMachinesContext();
  const view = views.find((one) => one.name === name);
  const cause = view === undefined || view.state === "connecting" ? undefined : machineCause(view);
  if (cause === undefined) return null;
  return (
    <Notice tone="warning" className="mx-1 mt-1" title={cause.title}>
      {cause.detail}
      <RetryButton size="sm" className="mt-2 flex" onRetry={() => retry(name)} />
    </Notice>
  );
}

/**
 * The spaces. With one machine they are one list whose header starts a new space; once more than one machine is
 * known, each machine is a list headed by its row (state, terminal count, New space there), in the machines' order.
 */
export function SpacesGroup({ terminals, active, onOpen, rail = false }: SpacesGroupProps) {
  const machines = useMachinesContext();
  if (!machines.machinesListed) return <SpacesLoading rail={rail} />;
  return <SpacesLists terminals={terminals} active={active} onOpen={onOpen} rail={rail} machines={machines} />;
}

/** Holds the spaces' place, labeled, until the first machine.list answer: one row, where the first machine row goes. */
function SpacesLoading({ rail }: { readonly rail: boolean }) {
  return (
    <SidebarSection title="Spaces" {...(rail ? { className: "[&>header]:sr-only" } : {})}>
      <div
        role="status"
        aria-label="Loading machines and spaces"
        className={cn("flex h-(--row) items-center text-xs text-muted-foreground", rail ? "justify-center" : "px-2")}
      >
        {rail ? <span aria-hidden className="size-1.5 rounded-full bg-dim" /> : "Loading machines…"}
      </div>
    </SidebarSection>
  );
}

function SpacesLists({
  terminals,
  active,
  onOpen,
  rail,
  machines,
}: SpacesGroupProps & { readonly rail: boolean; readonly machines: ReturnType<typeof useMachinesContext> }) {
  const spaces = useMemo(() => toSpaces(terminals), [terminals]);
  const colors = useSpaceColors(useMemo(() => spaces.map((space) => space.id), [spaces]));
  const colored = spaces.map((space): Space => {
    const color = colors[space.id];
    return color === undefined ? space : { ...space, color };
  });
  const activeTerminal = terminals.find((terminal) => terminal.address === active);
  const activeSpace = activeTerminal === undefined ? undefined : spaceId(activeTerminal);
  const openSpace = (id: string): void => {
    const address = firstInSpace(terminals, id);
    if (address !== undefined) onOpen(address);
  };
  const rows = (list: readonly Space[], grouped: boolean) =>
    list.map((space) => (
      <SpaceRow
        key={space.id}
        space={space}
        selected={space.id === activeSpace}
        onSelect={openSpace}
        rail={rail}
        hideMachine={grouped}
      />
    ));
  const grouped = machineGroups(machines.entries, colored);
  const local = machines.entries.find((machine) => machine.local);
  const newHere =
    grouped !== undefined || local === undefined || rail ? undefined : (
      <IconButton label="New space" icon={<Plus />} className="-mr-1" onClick={() => machines.start({})} />
    );
  const header = (machine: MachineEntry) => (
    <MachineHeader
      name={machine.name}
      local={machine.local}
      state={machine.local ? "this machine" : stateLabel(machine.state)}
      alarm={ALARM.has(machine.state)}
      live={machine.live}
      connected={machine.state === "connected"}
      rail={rail}
      onNewSpace={() => (machine.local ? machines.start({}) : machines.newTerminalOn(machine.name))}
      {...(machine.first === undefined ? {} : { onOpen: () => onOpen(machine.first ?? "") })}
    />
  );
  return (
    <SidebarSection
      title="Spaces"
      {...(grouped === undefined ? { count: spaces.length } : {})}
      {...(newHere === undefined ? {} : { action: newHere })}
      {...(rail ? { className: "[&>header]:sr-only" } : {})}
    >
      {machines.listError === undefined ? null : (
        <Notice tone="error" className="mx-1 mt-1" title="Could not list the machines">
          {machines.listError}
        </Notice>
      )}
      {grouped === undefined ? (
        <section aria-label="Spaces on this machine" className="flex flex-col gap-px">
          {rows(colored, false)}
        </section>
      ) : (
        <div className="flex flex-col gap-2">
          {grouped.map(({ machine, spaces: own }) => (
            <section key={machine.id} aria-label={machine.name} className="flex flex-col gap-px">
              {header(machine)}
              {rows(own, true)}
              {machine.local || rail ? null : <MachineNotice name={machine.name} />}
            </section>
          ))}
        </div>
      )}
    </SidebarSection>
  );
}
