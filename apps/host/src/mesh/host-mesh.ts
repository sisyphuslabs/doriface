import { DEFAULT_RELAY_URL, type HostIdentity, PAIRING_TTL_MS, type SecureLink, SessionKind } from "@doriface/crypto";
import type { CreateSocket } from "@doriface/relay-client";
import { parseTarget } from "../connect/target.ts";
import type { LiveSessions } from "../e2ee/sessions.ts";
import type { PairingSlots } from "../pairing-slots.ts";
import type { MeshStore, OwnCard } from "../state/mesh.ts";
import type { PendingPairing } from "../state/pairing.ts";
import { type HcCore, type HcCoreOptions, readHcCore } from "./hc-core.ts";
import { serveJoin } from "./invite.ts";
import { joinMesh } from "./join-dial.ts";
import { MeshLines } from "./lines.ts";
import { PendingJoins } from "./pending-joins.ts";

export interface HostMeshOptions {
  readonly stateDir: string;
  readonly identity: HostIdentity;
  readonly mesh: MeshStore;
  readonly slots: PairingSlots;
  readonly sessions: LiveSessions;
  readonly hc: HcCoreOptions;
  readonly relay: { readonly url: string | undefined; readonly createSocket?: CreateSocket | undefined };
  readonly log: (line: string) => void;
}

export interface MeshJoinRequest {
  readonly target: string;
  readonly fingerprint: string | undefined;
  readonly name: string | undefined;
  readonly relay: string | undefined;
  readonly yes: boolean;
}

/**
 * The running host's side of joining (section 4): it opens mesh offers, serves the joins they admit, holds the
 * pending joins until the inviting member decides, and runs a `mesh join` itself so the session it opens can stay up
 * as a sync session.
 */
export class HostMesh {
  readonly pending = new PendingJoins();
  readonly #options: HostMeshOptions;
  readonly #kept = new Set<SecureLink>();
  #core: Promise<HcCore> | undefined;
  #offerExpiresAt = 0;

  constructor(options: HostMeshOptions) {
    this.#options = options;
  }

  /** Opens a mesh offer (replacing any pending offer); with `auto`, its joins are admitted without asking. */
  async pair(auto: boolean): Promise<PendingPairing> {
    const offer = await this.#options.slots.open(true);
    this.#offerExpiresAt = offer.expiresAt;
    this.pending.setAuto(auto ? offer.expiresAt : 0);
    return offer;
  }

  /** Serves a session on the mesh stream: a join on a mesh offer. Sync sessions are not served yet (1000). */
  serve(secure: SecureLink): void {
    if (secure.kind === SessionKind.Session) return secure.close(1000, "this host serves no mesh sync session yet");
    const { identity, mesh, log } = this.#options;
    const expiresAt = this.#offerExpiresAt > Date.now() ? this.#offerExpiresAt : Date.now() + PAIRING_TTL_MS;
    const deps = { identity, mesh, pending: this.pending, own: () => this.#own(undefined), expiresAt, log };
    serveJoin(new MeshLines(secure), secure.remoteStatic, deps).then(
      () => this.#keep(secure),
      () => undefined,
    );
  }

  /** `mesh join` run by this host: refusals, the pairing handshake with the host key, the welcome, then it stays up. */
  async join(request: MeshJoinRequest): Promise<{ readonly meshId: string; readonly hostId: string }> {
    const { stateDir, identity, relay, log } = this.#options;
    const own = await this.#own(request.name);
    const joined = await joinMesh({
      stateDir,
      identity,
      target: parseTarget(request.target),
      fingerprint: request.fingerprint,
      name: own.name,
      hcId: own.hcId,
      yes: request.yes,
      confirm: async () => false,
      relayUrl: request.relay,
      defaultRelayUrl: relay.url ?? DEFAULT_RELAY_URL,
      createSocket: relay.createSocket,
      log,
    });
    this.#keep(joined.secure);
    return { meshId: joined.meshId, hostId: joined.hostId };
  }

  /** The session a join ran on stays open as a sync session, registered so a revoke closes it. */
  #keep(secure: SecureLink): void {
    this.#kept.add(secure);
    secure.onClose(() => this.#kept.delete(secure));
    this.#options.sessions.add(secure);
    this.#options.log("mesh: keeping the join's session for sync");
  }

  async #own(name: string | undefined): Promise<OwnCard> {
    this.#core ??= readHcCore(this.#options.hc);
    const core = await this.#core;
    return { name: name ?? core.name, hcId: core.id };
  }
}
