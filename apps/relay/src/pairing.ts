import {
  CloseCode,
  decodePairSlotRequest,
  encodePairSlotReply,
  PairSlotStatus,
  toBase64Url,
} from "@doriface/relay-client/wire";
import { type HostAttachment, patchHost } from "./attachment.ts";
import { sendControl } from "./flow.ts";
import type { PairSlotsEnv } from "./pair-slot.ts";

/**
 * Handles a PAIR_SLOT frame from an authenticated uplink: claims the slot and answers 200 or 409 on the uplink, or,
 * for an empty payload, releases the slot the uplink registered last and answers 200 for it.
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
    patchHost(host, { pairSlot: undefined });
    await slots.get(slots.idFromName(pairSlot)).release(attachment.hostId);
    return sendControl(host, encodePairSlotReply(pairSlot, PairSlotStatus.Registered));
  }
  const request = decodePairSlotRequest(payload);
  if (request === undefined || attachment.signPub === undefined) {
    return host.close(CloseCode.ProtocolError, "bad PAIR_SLOT frame");
  }
  const claimed = await slots.get(slots.idFromName(request.slot)).claim({
    hostId: attachment.hostId,
    noiseStaticPub: toBase64Url(request.noiseStaticPub),
    signPub: toBase64Url(attachment.signPub),
  });
  if (claimed) patchHost(host, { pairSlot: request.slot });
  sendControl(host, encodePairSlotReply(request.slot, claimed ? PairSlotStatus.Registered : PairSlotStatus.Taken));
}
