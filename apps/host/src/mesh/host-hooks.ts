import type { Signed } from "@doriface/mesh";
import type { BudgetFacts, LineFacts, PeerFacts, PendingJoinFact } from "./status-sources.ts";

/** The live facts of `mesh status` that only the running parts of the mesh hold (design sections 8.2 and 8.6). */
export interface MeshLiveFacts {
  readonly pending: readonly PendingJoinFact[];
  readonly peers: ReadonlyMap<string, PeerFacts>;
  readonly lines: ReadonlyMap<string, LineFacts>;
  readonly budget: BudgetFacts;
  readonly possiblyRevoked: boolean;
  /** The highest counter of this host's key that a peer's `hello` showed (section 10.1). */
  readonly peerCounter: number;
}

/**
 * The running parts of the mesh that the commands and the status reach through the host: joins (PR 4), sync and the
 * dial policy (PR 5), and the reconciler with its lines (PR 6). The host owns one; until those parts are wired into
 * it, it holds `IDLE_MESH_HOOKS`, which reaches no member.
 */
export interface MeshHooks {
  /** Pushes records this host signed (section 5.3); resolves with the signPubs of the members that confirmed. */
  push(records: readonly Signed[], withinMs: number): Promise<readonly string[]>;
  /** After `mesh leave` deleted mesh.json: removes this host's mesh machines (section 6.5). */
  left(): Promise<void>;
  live(): MeshLiveFacts;
}

export const IDLE_MESH_HOOKS: MeshHooks = {
  push: () => Promise.resolve([]),
  left: () => Promise.resolve(),
  live: () => ({
    pending: [],
    peers: new Map(),
    lines: new Map(),
    budget: { waiting: 0, halvedUntil: null },
    possiblyRevoked: false,
    peerCounter: 0,
  }),
};
