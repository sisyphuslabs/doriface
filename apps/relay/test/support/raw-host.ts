import {
  authMessage,
  decodeMux,
  ed25519Signer,
  encodeAuthAnswer,
  generateSigningKey,
  hostIdOf,
  type MuxFrame,
  relayOriginOf,
} from "@doriface/relay-client";
import { defer } from "./cleanup.ts";
import { Probe } from "./probe.ts";

export interface RawHost {
  readonly hostId: string;
  readonly probe: Probe;
  frame(): Promise<MuxFrame>;
}

/**
 * An uplink that answers the challenge and then only records frames: it never pings and never acks, which is how
 * the tests reach the relay's idle and backpressure limits from the host side.
 */
export async function startRawHost(
  relayUrl: string,
  ip: string,
  options: { readonly credit?: boolean } = {},
): Promise<RawHost> {
  const signer = ed25519Signer(generateSigningKey());
  const hostId = await hostIdOf(signer.publicKey);
  const url = `${relayUrl.replace("http", "ws")}/v1/host/${hostId}${options.credit === true ? "?credit=1" : ""}`;
  const probe = new Probe(url, ip);
  defer(() => probe.socket.close());
  const challenge = await probe.next();
  const signature = await signer.sign(authMessage(relayOriginOf(url), hostId, challenge));
  probe.socket.send(encodeAuthAnswer(signer.publicKey, signature));
  return { hostId, probe, frame: async () => decodeMux(await probe.next()) };
}
