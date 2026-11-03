import { Pin } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { StatusChip, StatusIndicator, type AgentStatus } from "./status.tsx";

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly status: AgentStatus;
  /** The tab name or the agent's title, after a middle dot. */
  readonly detail?: string;
  /** Shown for agents on another machine. */
  readonly machine?: string;
  /** Pre-formatted age: "<1m", "4m", "2h". */
  readonly age?: string;
  readonly icon?: ReactNode;
  readonly pinned?: boolean;
}

export interface AgentRowProps extends Omit<ComponentProps<"button">, "onSelect" | "children" | "className"> {
  readonly agent: Agent;
  readonly selected?: boolean;
  /** Use the "!" mark instead of the "Needs you" chip when a section header already says it. */
  readonly compactBlocked?: boolean;
  readonly onSelect?: (id: string) => void;
  readonly className?: string;
}

/** One agent in the sidebar or the phone list: status glyph, name, detail, machine, age. */
export function AgentRow({
  agent,
  selected = false,
  compactBlocked = false,
  onSelect,
  className,
  ...props
}: AgentRowProps) {
  const quiet = agent.status === "idle" && !selected;
  return (
    <button
      {...props}
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect?.(agent.id)}
      className={cn(
        "group flex h-(--row) w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-sm outline-none",
        "hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        selected && "bg-selected",
        className,
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {agent.status === "blocked" && !compactBlocked ? (
          <StatusIndicator status="blocked" decorative />
        ) : (
          <StatusIndicator status={agent.status} />
        )}
      </span>
      {agent.icon}
      <span className={cn("max-w-[50%] shrink-0 truncate", quiet ? "text-muted-foreground" : "text-foreground")}>
        {agent.name}
      </span>
      {agent.detail === undefined ? null : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">· {agent.detail}</span>
      )}
      {agent.detail === undefined ? <span className="flex-1" /> : null}
      {agent.machine === undefined ? null : (
        <span className="shrink-0 text-2xs text-muted-foreground">{agent.machine}</span>
      )}
      {agent.status === "blocked" && !compactBlocked ? <StatusChip status="blocked" /> : null}
      {agent.pinned === true ? <Pin aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground" /> : null}
      {agent.age === undefined ? null : (
        <time data-numeric className="shrink-0 text-xs text-muted-foreground">
          {agent.age}
        </time>
      )}
    </button>
  );
}
