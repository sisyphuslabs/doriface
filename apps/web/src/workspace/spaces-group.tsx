import type { Terminal } from "@doriface/protocol";
import {
  IconButton,
  MachineHeader,
  Menu,
  MenuItem,
  Notice,
  RowWithActions,
  SidebarSection,
  SpaceRow,
  cn,
  type Space,
} from "@doriface/ui";
import { Ellipsis, Pencil, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { machineCause } from "./machine-cause.ts";
import { type HeaderButton, MachineGroup } from "./machine-group.tsx";
import { stateLabel, type MachineEntry } from "./machines.ts";
import { firstInSpace, spaceId, toSpaces } from "./model.ts";
import { RetryButton } from "./retry-button.tsx";
import { SpaceNameInput } from "./space-name-input.tsx";
import { useSpaceRenaming } from "./space-rename-context.ts";
import { machineGroups } from "./sidebar-model.ts";
import { useSpaceColors } from "./sidebar-prefs.ts";
import { useMachineReorder } from "./use-machine-reorder.tsx";
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

/** A space row's "..." menu: Rename space asks for the new name; a double-click on the row edits it in place. */
function SpaceActions({ space }: { readonly space: Space }) {
  const renaming = useSpaceRenaming();
  return (
    <Menu align="end" trigger={<IconButton label={`More for ${space.name}`} icon={<Ellipsis />} className="size-6" />}>
      <MenuItem icon={<Pencil />} onClick={() => renaming.ask(space.id)}>
        Rename space…
      </MenuItem>
    </Menu>
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
  const [editing, setEditing] = useState<string | null>(null);
  const rows = (list: readonly Space[], grouped: boolean) =>
    list.map((space) => {
      if (!rail && space.id === editing)
        return <SpaceNameInput key={space.id} space={space} onClose={() => setEditing(null)} />;
      const row = (
        <SpaceRow
          key={space.id}
          space={space}
          selected={space.id === activeSpace}
          onSelect={openSpace}
          rail={rail}
          hideMachine={grouped}
        />
      );
      if (rail) return row;
      return (
        <div key={space.id} onDoubleClick={() => setEditing(space.id)}>
          <RowWithActions row={row} actions={<SpaceActions space={space} />} />
        </div>
      );
    });
  const grouped = machineGroups(machines.entries, colored);
  // The icon rail has no room for a drag handle or a menu; the full sidebar reorders.
  const list = useRef<HTMLDivElement>(null);
  const { reorderOf, overlay } = useMachineReorder(list, machines.entries, !rail);
  const local = machines.entries.find((machine) => machine.local);
  const newHere =
    grouped !== undefined || local === undefined || rail ? undefined : (
      <IconButton label="New space" icon={<Plus />} className="-mr-1" onClick={() => machines.start({})} />
    );
  const header = (machine: MachineEntry, button: HeaderButton | undefined) => (
    <MachineHeader
      {...(button === undefined ? {} : { buttonProps: button })}
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
        <div ref={list} className="relative flex flex-col gap-2">
          {overlay}
          {grouped.map(({ machine, spaces: own }, index) => (
            <MachineGroup
              key={machine.id}
              core={machine.core}
              name={machine.name}
              reorder={reorderOf(machine, index)}
              header={(button) => header(machine, button)}
            >
              {rows(own, true)}
              {machine.local || rail ? null : <MachineNotice name={machine.name} />}
            </MachineGroup>
          ))}
        </div>
      )}
    </SidebarSection>
  );
}
