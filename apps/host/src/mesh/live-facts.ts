import { MESH_LINE_STATES_WITH_REASON, type MeshLineState } from "@doriface/protocol";
import type { Clock } from "./clock.ts";
import type { DialPolicy } from "./dial-policy.ts";
import type { Gossip } from "./gossip.ts";
import type { MeshLiveFacts } from "./host-hooks.ts";
import type { MeshEntry } from "./reconciler.ts";
import type { LineFacts, PeerFacts } from "./status-sources.ts";

/** The running mesh parts `mesh status` reads its live facts from (design sections 8.2 and 8.6). */
export interface LiveParts {
  readonly policy: Pick<DialPolicy, "gate" | "unreachableSince" | "waiting" | "halvedUntil">;
  readonly gossip: Pick<
    Gossip,
    "view" | "self" | "lastSync" | "owedCount" | "session" | "peerCounter" | "possiblyRevoked"
  >;
  readonly reconciler: { lines(): readonly MeshEntry[] };
}

const LINE_STATES: readonly Exclude<MeshLineState, "self">[] = [
  "connected",
  "connecting",
  "unreachable",
  "hc_missing",
  "incompatible",
  "needs_login",
  "absent",
];

/** A line as herdr names its state; a state this version does not know reads as still connecting. */
const lineState = (state: string): Exclude<MeshLineState, "self"> =>
  LINE_STATES.find((known) => known === state) ?? "connecting";

/**
 * The live facts of the running mesh, each member keyed by its signPub. Times on the mesh's clock become wall times
 * through `wallNow`, so status shows when a probe is due and since when a member is unreachable.
 */
/** The facts `HostSync` hands status, apart from the pending joins, which the inviting side holds. */
export type SyncFacts = Omit<MeshLiveFacts, "pending">;

/** Before this host runs sync (no mesh.json yet): no member, no line, nothing waiting. */
export const NOT_RUNNING: SyncFacts = {
  peers: new Map(),
  lines: new Map(),
  budget: { waiting: 0, halvedUntil: null },
  possiblyRevoked: false,
  peerCounter: 0,
};

export function liveFactsOf(parts: LiveParts, clock: Clock, wallNow = Date.now()): SyncFacts {
  const wallAt = (at: number): Date => new Date(wallNow + at - clock.now());
  const wall = (at: number | undefined): Date | null => (at === undefined ? null : wallAt(at));
  const { policy, gossip } = parts;
  const members = gossip.view.members.filter((member) => member.signPub !== gossip.self);
  const peers = new Map<string, PeerFacts>();
  for (const { signPub } of members) {
    const gate = policy.gate(signPub);
    peers.set(signPub, {
      // Section 8.6: presence is an authenticated session from the member open now.
      presence: gossip.session(signPub) !== undefined,
      lastSync: wall(gossip.lastSync(signPub)),
      owed: gossip.owedCount(signPub),
      // A 4429 is this host's own rate limit, which the budget's halvedUntil names (section 8.2), not an offline member.
      gate: gate?.cause !== "offline" ? null : { refusals: gate.misses, nextProbeAt: wallAt(gate.nextAt) },
      unreachableSince: wall(policy.unreachableSince(signPub)),
    });
  }
  const keyOf = new Map(members.map((member) => [member.hostId, member.signPub]));
  const lines = new Map<string, LineFacts>();
  for (const { machine, hostId } of parts.reconciler.lines()) {
    const key = keyOf.get(hostId);
    if (key === undefined) continue;
    const state = lineState(machine.state);
    const reason = MESH_LINE_STATES_WITH_REASON.includes(state) ? (machine.why ?? null) : null;
    lines.set(key, { state, reason, stuck: null, helloCoreId: machine.id, replaced: null });
  }
  const budget = { waiting: policy.waiting(), halvedUntil: wall(policy.halvedUntil()) };
  return { peers, lines, budget, possiblyRevoked: gossip.possiblyRevoked, peerCounter: gossip.peerCounter };
}
