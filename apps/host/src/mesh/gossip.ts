import { base64urlEncode } from "@doriface/crypto";
import { hashOf, parseRecord, type Signed } from "@doriface/mesh";
import type { Clock, Random } from "./clock.ts";
import { type DialPolicy, type DialPurpose, type DueReason } from "./dial-policy.ts";
import { missingSince } from "./anti-entropy.ts";
import { ownN } from "../state/mesh-tx.ts";
import type { MemberEntry } from "./authorize-index.ts";
import type { MeshStore } from "../state/mesh.ts";
import type { LineLink } from "./lines.ts";
import type { MeshView } from "./mesh-view.ts";
import { MemberDialer } from "./member-dialer.ts";
import { MemberBook, StoredMesh } from "./stored-mesh.ts";
import { RevokedLast } from "./revoked-last.ts";
import { Claims } from "./claims.ts";
import { Sweeps } from "./sweeps.ts";
import { ackAdmission, appendOwn, type MergeDeps, type MergeResult, mergeBatch, type RecordDraft } from "./merge.ts";
import { type SyncHost, SyncSession } from "./sync.ts";

/** Section 5.1 and 5.3's timings, production values. */
export const GOSSIP_TIMINGS = {
  sweepAfterDownMs: 120_000,
  safetyNetMs: 600_000,
  safetyNetJitterMs: 120_000,
  revokedLastMs: 10_000,
  lingerMs: 60_000,
} as const;

export type GossipTimings = { readonly [K in keyof typeof GOSSIP_TIMINGS]: number };

export interface GossipOptions extends MergeDeps {
  readonly store: MergeDeps["store"] & Pick<MeshStore, "authorizeIndex">;
  readonly clock: Clock;
  readonly random: Random;
  readonly policy: DialPolicy;
  /** Opens a sync session (`stream:"mesh"`) to a member; rejects with the close code that refused it. */
  readonly dial: (member: MemberEntry) => Promise<LineLink>;
  readonly onView?: (view: MeshView, result: MergeResult) => void;
  readonly log: (line: string) => void;
  readonly timings?: GossipTimings;
}

/**
 * Keeps this host's record set converged with every member's (section 5): on-demand sync sessions to push what a
 * member is owed, a return sweep after this host's own outage, a safety net every 10 minutes, and presence-driven
 * delivery to members that were offline. No member is redialed just to keep a session.
 */
export class Gossip implements SyncHost {
  readonly meshId: string;
  /** This host's signPub. */
  readonly self: string;
  readonly #options: GossipOptions;
  readonly #timings: GossipTimings;
  readonly #stored: StoredMesh;
  readonly #claims: Claims;
  readonly #dialer: MemberDialer;
  readonly #sessions = new Map<string, SyncSession>();
  readonly #confirmed = new Map<string, readonly string[]>();
  readonly #lastSync = new Map<string, number>();
  readonly #sweeps: Sweeps;
  readonly #known = new MemberBook();
  readonly #revokedLast: RevokedLast;
  /** Revoked members whose released revoke push did not get through yet: retried as a revoke push when they are due. */
  readonly #revokeOwed = new Set<string>();
  #view: MeshView;
  #peerCounter = 0;

  constructor(options: GossipOptions) {
    this.#options = options;
    this.#stored = new StoredMesh(options.store);
    this.#dialer = new MemberDialer({
      policy: options.policy,
      dial: options.dial,
      flushOpen: (peer) => this.#flushOpen(peer),
      attach: (member, link, sweeping) => void this.attach(member.signPub, this.self, link, sweeping),
      log: options.log,
    });
    this.meshId = options.meshId;
    this.self = base64urlEncode(options.identity.sign.publicKey);
    this.#timings = options.timings ?? GOSSIP_TIMINGS;
    this.#revokedLast = new RevokedLast({
      clock: options.clock,
      waitMs: this.#timings.revokedLastMs,
      release: (key) => {
        const member = this.#known.get(key);
        if (member === undefined || !this.owed().includes(member)) return;
        this.#revokeOwed.add(key);
        void this.sync(member, "revoke-push");
      },
    });
    this.#sweeps = new Sweeps({
      ...options,
      timings: this.#timings,
      members: () => this.#members(),
      lastSync: (signPub) => this.#lastSync.get(signPub),
      sync: (member, purpose) => this.sync(member, purpose),
    });
    this.#claims = new Claims(
      () => options.clock.now(),
      (peer, n) =>
        options.log(
          `mesh: ${this.#known.nameOf(peer)} claimed counter ${n} of this host's key and ended its session without done: its claims are ignored for 10 minutes`,
        ),
    );
    this.#view = this.#stored.view();
    this.#known.remember(this.#view);
  }

  get view(): MeshView {
    return this.#view;
  }

  start(): void {
    this.#sweeps.start();
  }

  /** The joiner's ack of its own admission (section 5.5), once, owed to every member; false when nothing was signed. */
  ackAdmission(): boolean {
    const admitted = ackAdmission(this.#options);
    if (admitted !== undefined) this.#changed(admitted, true);
    return admitted !== undefined;
  }

  stop(): void {
    this.#sweeps.stop();
    this.#revokedLast.stop();
    for (const session of this.#sessions.values()) session.close(1000, "host stopping");
  }

  records(): readonly Signed[] {
    return this.#stored.records();
  }

  /** When this host last had a sync session with `peer`, on this host's clock. */
  lastSync(peer: string): number | undefined {
    return this.#lastSync.get(peer);
  }

  /** The highest counter of this host's key any peer's `hello` showed (section 10.1). */
  get peerCounter(): number {
    return this.#peerCounter;
  }

  /** A member refused this host's sync dial with 4401: this host may be revoked (section 8.6). */
  get possiblyRevoked(): boolean {
    return this.#dialer.refusedAsRevoked > 0;
  }

  /** How many stored records `peer` is not known to hold. */
  owedCount(peer: string): number {
    return missingSince(this.records(), this.#confirmed.get(peer) ?? []).length;
  }

  /** The open sync session with `peer`, if one is up. */
  session(peer: string): SyncSession | undefined {
    const open = this.#sessions.get(peer);
    return open?.closed === false ? open : undefined;
  }

  /** An authenticated sync session, inbound or outbound; one per peer, as section 5.1 picks it. */
  attach(peer: string, dialer: string, link: LineLink, sweeping = false, waitForHello = false): SyncSession {
    const ends = { peer, dialer, sweeping };
    const session = new SyncSession(ends, link, this, this.#options.clock, this.#timings.lingerMs);
    const existing = this.#sessions.get(peer);
    if (existing !== undefined && !existing.closed) {
      const keepOld =
        existing.dialer !== dialer && this.#known.hostIdOf(existing.dialer) < this.#known.hostIdOf(dialer);
      if (keepOld) {
        session.close(1000, "a session is already up");
        return session;
      }
      existing.close(1000, "replaced");
    }
    this.#sessions.set(peer, session);
    this.#dialer.accepted(peer);
    this.#lastSync.set(peer, this.#options.clock.now());
    if (dialer === peer) this.#options.policy.presence(peer);
    session.start(waitForHello);
    this.#retireIfGone(session);
    return session;
  }

  merge(session: SyncSession, batch: readonly Signed[]): MergeResult {
    const result = mergeBatch(this.#options, batch);
    this.#heldBy(session.peer, batch);
    for (const refusal of result.refused) {
      this.#options.log(
        `mesh: refused record ${refusal.hash} from ${this.#known.nameOf(session.peer)}: ${refusal.reason}`,
      );
    }
    if (result.counterBehind) {
      this.#options.log(
        "mesh: counter behind its own records (a restored backup): caught up, signing from the next merge",
      );
    }
    if (result.added.length > 0) {
      this.#options.log(`mesh: merged ${result.added.length} records from ${this.#known.nameOf(session.peer)}`);
      this.#changed(result, session.sweeping);
    }
    return result;
  }

  /** Records this host already signed through its store (a join's admit, a revoke): owed to every member. */
  stored(records: readonly Signed[]): void {
    const view = this.#stored.view();
    this.#changed({ added: records, refused: [], wanted: [], ack: undefined, counterBehind: false, view }, true);
  }

  /** Signs and pushes one record of this host's own (a revoke, a leave, a rename). */
  append(draft: RecordDraft): MergeResult {
    const floor = this.#claims.floor();
    const counterFloor = floor === undefined ? undefined : { n: floor.n, peer: this.#known.nameOf(floor.peer) };
    const result = appendOwn({ ...this.#options, ...(counterFloor === undefined ? {} : { counterFloor }) }, draft);
    this.#changed(result, true);
    return result;
  }

  /**
   * A peer's `hello`: the heads it holds, and the highest counter it holds of this host's own key. Above this host's
   * own, it signs no own record below that counter (section 10.1) until the peer's next `done`, which carries every
   * record of this host's the peer holds, for at most 30 s (see Claims).
   */
  heard(peer: string, heads: readonly string[], n: Readonly<Record<string, number>>): boolean {
    this.#confirmed.set(peer, heads);
    if (missingSince(this.records(), heads).length === 0) this.#revokeOwed.delete(peer);
    const claim = n[this.self] ?? 0;
    this.#peerCounter = Math.max(this.#peerCounter, claim);
    const owner = this.#sessions.get(peer);
    return owner !== undefined && claim > ownN(this.records(), this.self) && this.#claims.claim(peer, claim, owner);
  }

  /** The peer owed a `done` for 30 s without a line of progress: its session closes 4400 (and ends its claim). */
  overdue(session: SyncSession): void {
    if (this.#sessions.get(session.peer) !== session) return;
    this.#options.log(
      `mesh: closing the sync session with ${this.#known.nameOf(session.peer)}: no done within 30 s (4400)`,
    );
  }

  answered(session: SyncSession): void {
    if (this.#sessions.get(session.peer) === session) this.#claims.answered(session.peer);
  }

  /**
   * A stored record a peer sent, and its past, is one it holds (section 5.3: owed is what it is not known to hold).
   * Only stored hashes are kept, as the session's own set does: refused ones would grow it without bound.
   */
  #heldBy(peer: string, batch: readonly Signed[]): void {
    const stored = new Set(this.records().map(hashOf));
    const held = batch.map(hashOf).filter((hash) => stored.has(hash));
    this.#confirmed.set(peer, [...new Set([...(this.#confirmed.get(peer) ?? []), ...held])]);
  }

  /** The heads and records `peer` is known to hold: its last `hello`, and the stored records it sent since. */
  held(peer: string): readonly string[] {
    return this.#confirmed.get(peer) ?? [];
  }

  ended(session: SyncSession): void {
    this.#claims.ended(session.peer, session);
    if (this.#sessions.get(session.peer) === session) this.#sessions.delete(session.peer);
  }

  /** Members that are owed records: their confirmed heads do not cover this host's set. */
  owed(): readonly MemberEntry[] {
    const records = this.records();
    return this.#known
      .all()
      .filter(
        (member) =>
          member.signPub !== this.self && missingSince(records, this.#confirmed.get(member.signPub) ?? []).length > 0,
      );
  }

  /** The dial policy's wake-up: deliver what the member is owed. */
  due(signPub: string, reason: DueReason): void {
    const member = this.#known.get(signPub);
    if (member === undefined || this.#revokedLast.holds(signPub)) return;
    const owed = this.owed().includes(member);
    if (!owed) this.#revokeOwed.delete(signPub);
    if (owed && this.#revokeOwed.has(signPub)) void this.sync(member, "revoke-push");
    else if (reason === "probe" || owed) void this.sync(member, reason === "probe" ? "probe" : "push");
  }

  /** This host's uplink answered again; after a drop of more than 2 minutes it sweeps with one member. */
  uplinkReturned(downMs: number): void {
    this.#sweeps.uplinkReturned(downMs);
  }

  sync(member: MemberEntry, purpose: DialPurpose): Promise<boolean> {
    return this.#dialer.sync(member, purpose);
  }

  #flushOpen(peer: string): boolean {
    const open = this.#sessions.get(peer);
    if (open === undefined || open.closed) return false;
    open.flush();
    return true;
  }

  /**
   * Open sessions get the new records at once (ack forwarding). Only this host's own records and what it merged in a
   * sweep are owed onwards by dialing: a pushed batch is the pusher's to deliver (section 5.3).
   */
  #changed(result: MergeResult, owedOnwards: boolean): void {
    this.#view = result.view;
    this.#known.remember(result.view);
    this.#options.onView?.(result.view, result);
    for (const session of this.#sessions.values()) session.flush();
    if (owedOnwards) this.#push(result);
    for (const session of this.#sessions.values()) this.#retireIfGone(session);
  }

  /**
   * Section 6.2: a revoked member's inbound sessions close at once through LiveSessions; one this host dialed, at the
   * view change or later (section 5.3's last push to it), retires within the linger.
   */
  #retireIfGone(session: SyncSession): void {
    if (session.dialer !== this.self || this.#view.members.some((member) => member.signPub === session.peer)) return;
    const capped = this.#view.overCap.some((member) => member.signPub === session.peer);
    session.retire(capped ? "past the mesh's 12-member cap" : "revoked from the mesh");
  }

  /** Section 5.3: a revoke first; the revoked member last, after one ack came back or 10 s. */
  #push(result: MergeResult): void {
    const revoked = new Set<string>();
    for (const record of result.added) {
      const body = parseRecord(record);
      const subject = body?.type === "revoke" ? body.subject : undefined;
      if (subject !== undefined && "signPubs" in subject) for (const key of subject.signPubs) revoked.add(key);
    }
    const purpose: DialPurpose = revoked.size > 0 ? "revoke-push" : "push";
    for (const key of revoked) if (key !== this.self) this.#revokedLast.hold(key);
    for (const member of this.owed()) {
      if (!this.#revokedLast.holds(member.signPub)) void this.sync(member, purpose);
    }
  }

  #members(): readonly MemberEntry[] {
    return this.#view.members.filter((member) => member.signPub !== this.self);
  }
}
