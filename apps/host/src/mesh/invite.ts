import { base64urlDecode, base64urlEncode, CloseCode, fingerprintOf, type HostIdentity } from "@doriface/crypto";
import { type CardBody, MAX_MESH_MEMBERS, type Signed, verifyCard } from "@doriface/mesh";
import type { MeshStore, OwnCard } from "../state/mesh.ts";
import { type MeshLines, recordLines } from "./lines.ts";
import type { PendingJoins } from "./pending-joins.ts";

export interface InviteDeps {
  readonly identity: HostIdentity;
  readonly mesh: MeshStore;
  readonly pending: PendingJoins;
  /** This host's own card fields, for the found it writes when it has no mesh yet. */
  readonly own: () => Promise<OwnCard>;
  /** The offer's expiry: a pending join expires with it. */
  readonly expiresAt: number;
  readonly log: (line: string) => void;
}

export class JoinRefused extends Error {
  override readonly name = "JoinRefused";
}

const nonce = (): string => base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

/** Founds the mesh if this host has none (a concurrent founding wins and is used), and returns its id. */
async function meshIdFor(deps: InviteDeps): Promise<string> {
  if (deps.mesh.read() === undefined) deps.mesh.found(deps.identity, await deps.own());
  const file = deps.mesh.read();
  if (file === undefined) throw new JoinRefused("cannot found the mesh");
  return file.meshId;
}

/** Section 4.4 step 3: the card must be for exactly this offer and bound to the Noise key that just proved itself. */
function checkCard(
  signed: Signed,
  offer: { mesh: string; inviter: string; nonce: string },
  peer: Uint8Array,
): CardBody {
  const card = verifyCard(signed);
  if (card === undefined) throw new JoinRefused("the card does not verify");
  if (card.mesh !== offer.mesh || card.inviter !== offer.inviter || card.nonce !== offer.nonce) {
    throw new JoinRefused("the card is not for this offer");
  }
  if (card.noisePub !== base64urlEncode(peer)) throw new JoinRefused("the card's Noise key is not the session's");
  return card;
}

function sendWelcome(lines: MeshLines, deps: InviteDeps, meshId: string): void {
  for (const line of recordLines(deps.mesh.read()?.records ?? [])) lines.send(line);
  lines.send({ t: "done", mesh: meshId });
}

/**
 * The inviting member's side of a join (sections 4.3 and 4.4), on a session the mesh offer admitted: offer, card,
 * the confirmation, the admit, then the welcome. A refusal sends `refused` and closes 4401; the session otherwise
 * stays open for sync. Resolves with the admitted card.
 */
export async function serveJoin(lines: MeshLines, peerStatic: Uint8Array, deps: InviteDeps): Promise<CardBody> {
  try {
    const meshId = await meshIdFor(deps);
    const offer = { mesh: meshId, inviter: base64urlEncode(deps.identity.sign.publicKey), nonce: nonce() };
    lines.send({ t: "offer", ...offer });
    const reply = await lines.next();
    if (reply.t !== "card") throw new JoinRefused(`expected a card, got ${reply.t}`);
    const card = checkCard(reply, offer, peerStatic);
    const index = deps.mesh.authorizeIndex();
    if (index?.isMember(card.signPub) === true) {
      sendWelcome(lines, deps, meshId);
      return card;
    }
    if ((index?.memberCount ?? 0) >= MAX_MESH_MEMBERS) throw new JoinRefused("the mesh is full");
    const fingerprint = fingerprintOf(base64urlDecode(card.noisePub));
    const join = { nonce: offer.nonce, name: card.name, hostId: card.hostId, fingerprint, expiresAt: deps.expiresAt };
    const decision = await deps.pending.ask(join);
    if (decision !== "approved") throw new JoinRefused(`the join was ${decision} on the inviting member`);
    deps.mesh.sign(deps.identity, (n, prev) => ({
      v: 2,
      mesh: meshId,
      type: "admit",
      by: offer.inviter,
      n,
      prev,
      subject: { card: reply },
    }));
    deps.log(`mesh: admitted "${card.name}" ${card.hostId}, fingerprint ${fingerprint}`);
    sendWelcome(lines, deps, meshId);
    return card;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.log(`mesh: join refused: ${reason}`);
    lines.refuse(CloseCode.UnknownDevice, reason);
    throw error;
  }
}
