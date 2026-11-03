import { IDLE_TIMEOUT_MS } from "@doriface/relay-client/wire";
import type { Attachment } from "./attachment.ts";
import { AUTH_TIMEOUT_MS } from "./limits.ts";
import { withAttachment } from "./sockets.ts";

/** Time from a client's OPEN to the host's first DATA on it (contract v1.2 C1). */
export const PENDING_TIMEOUT_MS = 10_000;

export interface Timeouts {
  readonly pendingMs: number;
  readonly idleMs: number;
  readonly authMs: number;
}

/** Overrides for local tests; production leaves them unset. */
export interface TimeoutVars {
  readonly PENDING_TIMEOUT_MS?: string;
  readonly IDLE_TIMEOUT_MS?: string;
  readonly AUTH_TIMEOUT_MS?: string;
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function timeoutsOf(vars: TimeoutVars): Timeouts {
  return {
    pendingMs: positive(vars.PENDING_TIMEOUT_MS, PENDING_TIMEOUT_MS),
    idleMs: positive(vars.IDLE_TIMEOUT_MS, IDLE_TIMEOUT_MS),
    authMs: positive(vars.AUTH_TIMEOUT_MS, AUTH_TIMEOUT_MS),
  };
}

export interface Expired {
  readonly ws: WebSocket;
  readonly attachment: Attachment;
  readonly reason: string;
}

/**
 * Sockets past a deadline at `now`: a pending session without host DATA, or any socket whose last auto-answered
 * `ping` (or, before the first, its accept) is older than the idle timeout. Also returns the next deadline.
 */
export function overdue(
  ctx: DurableObjectState,
  timeouts: Timeouts,
  now: number,
): { readonly expired: Expired[]; readonly next: number | undefined } {
  const expired: Expired[] = [];
  let next: number | undefined;
  for (const { ws, attachment } of withAttachment(ctx)) {
    if (attachment.role === "client" && attachment.ended) continue;
    const lastPing = ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
    const idleAt = Math.max(lastPing, attachment.openedAt) + timeouts.idleMs;
    const pendingAt =
      attachment.role === "client" && attachment.pending ? attachment.openedAt + timeouts.pendingMs : Infinity;
    const deadline = Math.min(idleAt, pendingAt);
    if (deadline <= now) {
      expired.push({ ws, attachment, reason: pendingAt <= now ? "no host data in time" : "idle" });
    } else {
      next = Math.min(next ?? deadline, deadline);
    }
  }
  return { expired, next };
}

/** Moves the alarm earlier to `at` if none is set or the one set fires later. */
export async function alarmBy(ctx: DurableObjectState, at: number): Promise<void> {
  const current = await ctx.storage.getAlarm();
  if (current === null || current > at) await ctx.storage.setAlarm(at);
}
