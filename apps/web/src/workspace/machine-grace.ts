import type { MachineView } from "@doriface/protocol";

/**
 * How long a machine read connected may then read connecting or unreachable before the page shows it offline (#904).
 *
 * hc marks a machine unreachable on the first failed redial, within 50 ms of its line ending, and a healthy line ends
 * often: any relay blip ends every mesh line at once, the host then refuses new lines for its 10-20 s settle
 * (apps/host/src/mesh/dial-policy.ts, DIAL_LIMITS.settleMaxMs), and hc's doubling redial lands the line 16-32 s after
 * the drop. 45 s covers that with a margin, so a blip never reads offline, while a machine that is really gone (a laptop
 * asleep) reads offline 45 s after its line dropped. needs_login is an answer, not a blip: it shows at once.
 */
export const OFFLINE_GRACE_MS = 45_000;

const DOWN = new Set(["connecting", "unreachable"]);

/**
 * The longest a drop can precede the read that first sees it: one periodic machine.list read (MACHINE_REFRESH_MS). hc's
 * `since_ms` is the host's clock, so it only moves a hold's start back within this bound, never past it.
 */
const READ_LAG_MS = 10_000;

/** Since when (this page's clock) each machine, by its permanent id, has read down while held as connected. */
export type Held = ReadonlyMap<string, number>;

/**
 * The hold after one machine.list answer read at `now`. A machine that reads down after it last read connected is held
 * from its drop: hc's `since_ms`, kept within the one read before `now`; one held already keeps its start; one this page never saw connected is held only when hc's own
 * `since_ms` puts its drop inside the grace (a page opened mid-blip). Anything else (connected, needs_login, down past
 * the grace, gone from the list) is not held.
 */
export function stepHeld(
  held: Held,
  before: readonly MachineView[],
  list: readonly MachineView[],
  now: number,
): Map<string, number> {
  const wasConnected = new Set(before.filter((view) => view.state === "connected").map((view) => view.id));
  const next = new Map<string, number>();
  for (const view of list) {
    if (!DOWN.has(view.state)) continue;
    const dropped = view.since_ms ?? now;
    const since =
      held.get(view.id) ??
      (wasConnected.has(view.id) ? Math.min(now, Math.max(now - READ_LAG_MS, dropped)) : (view.since_ms ?? undefined));
    if (since !== undefined && now - since < OFFLINE_GRACE_MS) next.set(view.id, since);
  }
  return next;
}

/** What the page shows at `now`: a held machine inside its grace as connected, every other one as hc said. */
export function graceViews(list: readonly MachineView[], held: Held, now: number): readonly MachineView[] {
  if (held.size === 0) return list;
  return list.map((view) => {
    const since = held.get(view.id);
    if (since === undefined || now - since >= OFFLINE_GRACE_MS) return view;
    return { ...view, state: "connected", why: null, since_ms: null };
  });
}

/** When the next held machine's grace ends (this page's clock), so the page can show it offline then; none if none. */
export function graceEnds(held: Held, now: number): number | undefined {
  const ends = [...held.values()].map((since) => since + OFFLINE_GRACE_MS).filter((end) => end > now);
  return ends.length === 0 ? undefined : Math.min(...ends);
}
