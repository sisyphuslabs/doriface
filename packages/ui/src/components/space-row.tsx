import { Folder } from "lucide-react";
import { useRef } from "react";
import { cn } from "../lib/cn.ts";
import { useRowFloors } from "./row-floors.ts";
import { SpaceAvatar, type AvatarColor } from "./space-avatar.tsx";
import { StatusIndicator, type AgentStatus } from "./status.tsx";

export interface Space {
  readonly id: string;
  readonly name: string;
  readonly machine?: string;
  /** Number of tabs. */
  readonly tabs: number;
  /** The most urgent agent status inside, if any. */
  readonly attention?: AgentStatus;
  /** Its avatar colour; a folder stands in until one is assigned. */
  readonly color?: AvatarColor;
}

export interface SpaceRowProps {
  readonly space: Space;
  readonly selected?: boolean;
  readonly onSelect?: (id: string) => void;
  /** The sidebar is an icon rail: the avatar alone, the name as its label and tooltip. */
  readonly rail?: boolean;
  /** Under a machine's header the machine is already said, so the row leaves it out. */
  readonly hideMachine?: boolean;
  readonly className?: string;
}

/**
 * A workspace (herdr space) in the sidebar: avatar, name, machine, its most urgent agent, tab count. When the row is
 * short the machine gives way first; the name keeps five characters and an ellipsis (see useRowFloors).
 */
export function SpaceRow({
  space,
  selected = false,
  onSelect,
  rail = false,
  hideMachine = false,
  className,
}: SpaceRowProps) {
  const row = useRef<HTMLButtonElement | null>(null);
  const machine = hideMachine ? undefined : space.machine;
  useRowFloors(row, `${space.name}\u0000${machine ?? ""}`);
  const mark =
    space.color === undefined ? (
      <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    ) : (
      <SpaceAvatar name={space.name} color={space.color} />
    );
  return (
    <button
      ref={row}
      type="button"
      aria-current={selected ? "true" : undefined}
      {...(rail ? { "aria-label": space.name, title: space.name } : {})}
      onClick={() => onSelect?.(space.id)}
      className={cn(
        "flex h-(--row) w-full min-w-0 items-center gap-2.5 rounded-md text-left text-sm text-foreground outline-none",
        "hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring",
        rail ? "justify-center px-0" : "px-2",
        selected && "bg-selected",
        className,
      )}
    >
      {mark}
      {rail ? null : (
        <>
          <span title={space.name} data-floor="name" className="min-w-0 flex-1 truncate">
            {space.name}
          </span>
          {machine === undefined ? null : (
            <span
              title={machine}
              data-floor="machine"
              className="min-w-0 max-w-[35%] truncate text-2xs text-muted-foreground"
            >
              {machine}
            </span>
          )}
          <span data-row-meta className="flex shrink-0 items-center gap-2.5">
            {space.attention === undefined ? null : <StatusIndicator status={space.attention} className="size-3" />}
            <span
              data-numeric
              aria-label={`${space.tabs} tabs`}
              className="w-4 text-right text-xs text-muted-foreground"
            >
              {space.tabs}
            </span>
          </span>
        </>
      )}
    </button>
  );
}
