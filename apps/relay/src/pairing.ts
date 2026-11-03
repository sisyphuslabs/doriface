import {
  CloseCode,
  decodePairSlotRequest,
  encodePairSlotAck,
  PairSlotAckStatus,
  slotOf,
  toBase64Url,
} from "@doriface/relay-client/wire";
import { type HostAttachment, patchHost } from "./attachment.ts";
import { sendControl } from "./flow.ts";
import type { PairSlotsEnv } from "./pair-slot.ts";

/**
 * Handles a PAIR_SLOT frame from an authenticated uplink and answers it with a PAIR_SLOT_ACK: registered or taken for
 * a claim; registered for an empty payload, which releases the slot the uplink registered last; malformed for a
 * request whose slot is readable but whose payload is not. A payload with no readable slot closes the uplink (4402).
 */
export async function handlePairSlot(
  env: PairSlotsEnv,
  host: WebSocket,
  attachment: HostAttachment,
  payload: Uint8Array,
): Promise<void> {
  const slots = env.PAIR_SLOTS;
  const { pairSlot } = attachment;
  if (payload.byteLength === 0) {
    if (pairSlot === undefined) return;
    // Released first: if the release fails, the uplink still knows its slot and a retried clear can release it.
    await slots.get(slots.idFromName(pairSlot)).release(attachment.hostId);
    patchHost(host, { pairSlot: undefined });
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
    patchHost(host, { pairSlot: request.slot });
  }
  sendControl(host, encodePairSlotAck(request.slot, claimed ? PairSlotAckStatus.Registered : PairSlotAckStatus.Taken));
}
