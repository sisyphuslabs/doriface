import {
  CloseCode,
  decodePairSlotRequest,
  encodePairSlotReply,
  PairSlotStatus,
  toBase64Url,
} from "@doriface/relay-client/wire";
import type { HostAttachment } from "./attachment.ts";
import type { PairSlotsEnv } from "./pair-slot.ts";
import { sendIfOpen } from "./sockets.ts";

/** Handles a PAIR_SLOT frame from an authenticated uplink: claims the slot and answers 200 or 409 on the uplink. */
export async function registerPairSlot(
  env: PairSlotsEnv,
  host: WebSocket,
  attachment: HostAttachment,
  payload: Uint8Array,
): Promise<void> {
  const request = decodePairSlotRequest(payload);
  if (request === undefined || attachment.signPub === undefined) {
    return host.close(CloseCode.ProtocolError, "bad PAIR_SLOT frame");
  }
  const slots = env.PAIR_SLOTS;
  const claimed = await slots.get(slots.idFromName(request.slot)).claim({
    hostId: attachment.hostId,
    noiseStaticPub: toBase64Url(request.noiseStaticPub),
    signPub: toBase64Url(attachment.signPub),
  });
  sendIfOpen(host, encodePairSlotReply(request.slot, claimed ? PairSlotStatus.Registered : PairSlotStatus.Taken));
}
