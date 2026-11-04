import { AgentRow, IconButton, Sheet, SidebarSection, StatusChip, StatusIndicator, cn } from "@doriface/ui";
import { ArrowLeftRight, ChevronLeft } from "lucide-react";
import { useState } from "react";
import {
  agentCounts,
  agentStatus,
  machineOf,
  type Session,
  spaceId,
  spaceName,
  tabPosition,
  terminalTitle,
  toAgent,
  toSpaces,
} from "./model.ts";
import { SessionMenu } from "./session-menu.tsx";
import { useNow } from "./use-now.ts";

export interface PhoneHeaderProps {
  readonly terminal: Session;
  readonly terminals: readonly Session[];
  readonly onBack: () => void;
  readonly onOpen: (address: string) => void;
}

const COUNTED = [
  { status: "done", word: "done" },
  { status: "working", word: "working" },
  { status: "idle", word: "idle" },
] as const;

/** The phone terminal's header, after herdr-app's: name and state, where it is (n/m), the agent counts, a switch. */
export function PhoneHeader({ terminal, terminals, onBack, onOpen }: PhoneHeaderProps) {
  const title = terminalTitle(terminal);
  const machine = machineOf(terminal.address);
  const where = machine === undefined ? spaceName(terminal) : `${machine} · ${spaceName(terminal)}`;
  const position = tabPosition(terminals, terminal.address);
  const counts = agentCounts(terminals);
  return (
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
        {/* Under text spacing the counts wrap to a line of their own before the place gives up its last letters. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-tight text-muted-foreground">
          <p title={where} className="min-w-0 grow basis-8 truncate">
            {where}
          </p>
          {position === undefined ? null : (
            <span data-tab-position data-numeric className="shrink-0">
              <span aria-hidden>{`${position.index}/${position.count}`}</span>
              <span className="sr-only">{`Tab ${position.index} of ${position.count}`}</span>
            </span>
          )}
          <span data-agent-counts data-numeric className="ml-auto flex shrink-0 items-center gap-1.5">
            {COUNTED.map(({ status, word }, index) => (
              <span key={status} className="inline-flex items-center gap-0.5">
                <StatusIndicator
                  status={status}
                  decorative
                  className={cn("size-3", counts[status] === 0 && "[&_svg]:animate-none")}
                />
                {counts[status]}
                <span className="sr-only">{index === COUNTED.length - 1 ? ` ${word}` : ` ${word}, `}</span>
              </span>
            ))}
          </span>
        </div>
      </div>
      <SpaceSwitcher terminals={terminals} active={terminal.address} onOpen={onOpen} />
      <SessionMenu address={terminal.address} title={title} placement="header" />
    </header>
  );
}

/** A bottom sheet of every space with its tabs; picking a tab opens it on the phone. */
function SpaceSwitcher(props: {
  readonly terminals: readonly Session[];
  readonly active: string;
  readonly onOpen: (address: string) => void;
}) {
  const { terminals, active, onOpen } = props;
  const [open, setOpen] = useState(false);
  const now = useNow();
  const pick = (address: string): void => {
    setOpen(false);
    onOpen(address);
  };
  return (
    <Sheet
      title="Spaces"
      side="bottom"
      open={open}
      onOpenChange={setOpen}
      trigger={<IconButton label="Switch space or tab" icon={<ArrowLeftRight />} size="md" />}
    >
      <div className="flex flex-col gap-4">
        {toSpaces(terminals).map((space) => (
          <SidebarSection
            key={space.id}
            title={space.machine === undefined ? space.name : `${space.machine} · ${space.name}`}
            count={space.tabs}
          >
            {terminals
              .filter((entry) => entry.state === "live" && spaceId(entry) === space.id)
              .map((entry) => (
                <AgentRow
                  key={entry.address}
                  agent={toAgent(entry, now)}
                  selected={entry.address === active}
                  onSelect={pick}
                />
              ))}
          </SidebarSection>
        ))}
      </div>
    </Sheet>
  );
}
