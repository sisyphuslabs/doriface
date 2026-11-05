import { Monitor, Plus, Server } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { IconButton } from "./icon-button.tsx";

export interface MachineHeaderProps {
  readonly name: string;
  /** The machine this client is connected to. */
  readonly local: boolean;
  /** Its state in words ("this machine", "connecting", "offline", "needs login"). */
  readonly state: string;
  /** Says the state in the blocked ink: offline or needs login. */
  readonly alarm?: boolean;
  /** Live terminals on it. */
  readonly live: number;
  readonly selected?: boolean;
  /** Opens its first terminal; left out when it has none (the header stays a stop for its action). */
  readonly onOpen?: () => void;
  /** Starts a new space on it; disabled while it is not connected. */
  readonly onNewSpace: () => void;
  readonly connected: boolean;
  readonly rail?: boolean;
  readonly className?: string;
}

/**
 * The head of one machine's spaces, shown once more than one machine is known: icon, name, state, terminal count,
 * and "New space on <name>". The row is the group's first stop; the action follows it with ArrowRight.
 */
export function MachineHeader({
  name,
  local,
  state,
  alarm = false,
  live,
  selected = false,
  onOpen,
  onNewSpace,
  connected,
  rail = false,
  className,
}: MachineHeaderProps) {
  const Icon = local ? Monitor : Server;
  const quiet = onOpen === undefined && "opacity-45";
  return (
    <div className={cn("group flex h-(--row) min-w-0 items-center rounded-md", selected && "bg-selected", className)}>
      <button
        type="button"
        data-machine-header={name}
        aria-current={selected ? "true" : undefined}
        aria-disabled={onOpen === undefined || undefined}
        {...(rail ? { "aria-label": `${name}, ${state}`, title: `${name}, ${state}` } : {})}
        onClick={() => onOpen?.()}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left text-xs font-medium text-muted-foreground outline-none",
          "hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:hover:bg-transparent",
          rail ? "justify-center px-0" : "px-2",
        )}
      >
        <Icon aria-hidden className={cn("size-3.5 shrink-0", quiet)} />
        {rail ? null : (
          <>
            <span title={name} className={cn("min-w-0 flex-1 truncate", quiet)}>
              {name}
            </span>
            <span className={cn("shrink-0 text-2xs font-normal", alarm && "text-status-blocked-text")}>{state}</span>
            <span data-numeric aria-label={`${live} terminals`} className={cn("w-4 shrink-0 text-right", quiet)}>
              {live}
            </span>
          </>
        )}
      </button>
      {rail ? null : (
        <IconButton
          label={`New space on ${name}`}
          icon={<Plus />}
          disabled={!connected}
          onClick={onNewSpace}
          className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 coarse:opacity-100 data-disabled:opacity-0 group-hover:data-disabled:opacity-45"
        />
      )}
    </div>
  );
}
