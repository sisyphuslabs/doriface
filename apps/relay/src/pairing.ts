import {
  CloseCode,
  decodePairSlotRequest,
  encodePairSlotAck,
  PairSlotAckStatus,
  slotOf,
  toBase64Url,
} from "@doriface/relay-client/wire";
import type { HostAttachment } from "./attachment.ts";
import { sendControl } from "./flow.ts";
import type { PairSlotsEnv } from "./pair-slot.ts";

/**
 * Handles a PAIR_SLOT frame from an authenticated uplink and answers it with a PAIR_SLOT_ACK: registered or taken for
 * a claim; registered for an empty payload, which releases the host's registered slot, whichever uplink registered it
 * (with no slot registered there is nothing to name, so no ack); malformed for a request whose slot is readable but whose payload is
 * not. A payload with no readable slot closes the uplink (4402).
 */
/** The host's registered slot, kept in its Room's storage: it belongs to the host and outlives any one uplink. */
const HOST_SLOT = "pairSlot";

export async function handlePairSlot(
  env: PairSlotsEnv,
  storage: DurableObjectStorage,
  host: WebSocket,
  attachment: HostAttachment,
  payload: Uint8Array,
): Promise<void> {
  const slots = env.PAIR_SLOTS;
  const pairSlot = await storage.get<string>(HOST_SLOT);
  if (payload.byteLength === 0) {
    if (pairSlot === undefined) return;
    // Released first: if the release fails, the host's slot is still recorded and a retried clear can release it.
    await slots.get(slots.idFromName(pairSlot)).release(attachment.hostId);
    await storage.delete(HOST_SLOT);
    return sendControl(host, encodePairSlotAck(pairSlot, PairSlotAckStatus.Registered));
  }
  const request = decodePairSlotRequest(payload);
  if (request === undefined || attachment.signPub === undefined) {
    const slot = slotOf(payload);
    if (slot === undefined) return host.close(CloseCode.RelayProtocolError, "bad PAIR_SLOT frame");
    return sendControl(host, encodePairSlotAck(slot, PairSlotAckStatus.Malformed));
  }
  const claimed = await slots.get(slots.idFromName(request.slot)).claim({
    hostId: attachment.hostId,
    noiseStaticPub: toBase64Url(request.noiseStaticPub),
    signPub: toBase64Url(attachment.signPub),
  });
  if (claimed) {
    if (pairSlot !== undefined && pairSlot !== request.slot) {
      await slots.get(slots.idFromName(pairSlot)).release(attachment.hostId);
    }
    await storage.put(HOST_SLOT, request.slot);
  }
  sendControl(host, encodePairSlotAck(request.slot, claimed ? PairSlotAckStatus.Registered : PairSlotAckStatus.Taken));
}

/** Why a `?pair=<slot>` session to `hostId` is refused, as a close code, or undefined when it is admitted. */
export async function pairingRefusal(
  env: PairSlotsEnv,
  hostId: string,
  slot: string,
  source: string,
): Promise<{ readonly code: number; readonly reason: string } | undefined> {
  const verdict = await env.PAIR_SLOTS.get(env.PAIR_SLOTS.idFromName(slot)).admitOpen(hostId, source);
  if (verdict === "not-held") return { code: CloseCode.PairSlotUnknown, reason: "no host is pairing on this slot" };
  if (verdict === "limited") return { code: CloseCode.RateLimited, reason: "pairing budget spent for this slot" };
  return undefined;
}

/**
 * Charges answered pairing sessions to their slot's budget. The charge happens on the host's first DATA; later DATA
 * on the same session waits for it, so frames stay in order and nothing passes a refused charge.
 */
export class PairingCharges {
  readonly #env: PairSlotsEnv;
  readonly #pending = new Map<number, Promise<boolean>>();

  constructor(env: PairSlotsEnv) {
    this.#env = env;
  }

  charge(sessionId: number, slot: string): Promise<boolean> {
    const charged = this.#env.PAIR_SLOTS.get(this.#env.PAIR_SLOTS.idFromName(slot)).chargeSession();
    this.#pending.set(sessionId, charged);
    void charged.finally(() => this.#pending.delete(sessionId));
    return charged;
  }

  /** The session's charge while it is still running; later DATA awaits it. */
  inFlight(sessionId: number): Promise<boolean> | undefined {
    return this.#pending.get(sessionId);
  }
}
