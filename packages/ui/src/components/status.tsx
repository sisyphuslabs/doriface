import { cn } from "../lib/cn.ts";
import { Spinner } from "./spinner.tsx";

export type AgentStatus = "working" | "blocked" | "done" | "idle" | "unknown";

export const STATUS_LABEL: Readonly<Record<AgentStatus, string>> = {
  working: "Working",
  blocked: "Needs you",
  done: "Done",
  idle: "Idle",
  unknown: "Unknown",
};

const COLOR: Readonly<Record<AgentStatus, string>> = {
  working: "text-status-working",
  blocked: "text-status-blocked",
  done: "text-status-done",
  idle: "text-status-idle",
  unknown: "text-status-unknown",
};

export interface StatusIndicatorProps {
  readonly status: AgentStatus;
  readonly className?: string;
  /** Hide the label from assistive tech when visible text already says it. */
  readonly decorative?: boolean;
}

/**
 * herdr-app's status grammar, readable without colour: working spins, blocked is a "!" mark,
 * done is a filled dot, idle and unknown are a ring.
 */
export function StatusIndicator({ status, className, decorative = false }: StatusIndicatorProps) {
  const label = decorative ? undefined : STATUS_LABEL[status];
  return (
    <span
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={cn("inline-flex size-3.5 shrink-0 items-center justify-center", COLOR[status], className)}
    >
      {status === "working" ? <Spinner /> : null}
      {status === "blocked" ? (
        <span className="flex size-3.5 items-center justify-center rounded-xs bg-status-blocked/15 text-2xs leading-none font-bold text-status-blocked-text">
          !
        </span>
      ) : null}
      {status === "done" ? <span className="size-[7px] rounded-full bg-current" /> : null}
      {status === "idle" || status === "unknown" ? (
        <span className="size-[7px] rounded-full border-[1.5px] border-current" />
      ) : null}
    </span>
  );
}

export interface StatusChipProps {
  readonly status: AgentStatus;
  readonly className?: string;
}

/** The labelled form: the shape plus its word, used where there is room. */
export function StatusChip({ status, className }: StatusChipProps) {
  const tint = {
    working: "bg-status-working/15 text-status-working-text",
    blocked: "bg-status-blocked/15 text-status-blocked-text",
    done: "bg-status-done/15 text-status-done-text",
    idle: "bg-selected text-muted-foreground",
    unknown: "bg-selected text-muted-foreground",
  }[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-xs pr-1.5 pl-1 text-2xs font-semibold whitespace-nowrap",
        tint,
        className,
      )}
    >
      <StatusIndicator status={status} decorative className="size-3" />
      {STATUS_LABEL[status]}
    </span>
  );
}
