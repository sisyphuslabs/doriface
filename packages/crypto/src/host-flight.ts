import { assertCpaceShare, cpaceRespond } from "./cpace.ts";
import { concatBytes } from "./encoding.ts";
import { prologueFor } from "./identity.ts";
import { type FirstMessage, SessionKind, splitFirstMessage } from "./kinds.ts";
import { Handshake } from "./noise/handshake.ts";
import { codePairingInputs, codePairingPsk, linkPairingPsk } from "./pairing-keys.ts";
import { decodeHello, encodeReply, type Hello } from "./payloads.ts";
import type { StaticKey } from "./static-key.ts";

/** A client's first message, read and authenticated by the host but not answered yet. */
export interface ReadFlight {
  readonly message: FirstMessage;
  readonly handshake: Handshake;
  readonly hello: Hello;
  readonly remoteStatic: Uint8Array;
}

/** What the host pairs with, chosen by its authorization; a session needs nothing. */
export type HostPairingSecret =
  | { readonly mode: "code"; readonly code: string }
  | { readonly mode: "link"; readonly linkSecret: Uint8Array };

/** Fixed randomness, for tests only (not exported from the package). */
export interface HostFlightTestOptions {
  readonly ephemeralSecret?: Uint8Array;
  readonly cpaceScalar?: bigint;
}

/**
 * Reads a client's first message: splits it by kind, checks a typed code's CPace share before any Noise work, then
 * reads message 1 under the kind's prologue and decodes its payload. Nothing here depends on a pairing secret, so a
 * caller may refuse afterwards without having tested any code. Throws on any failure.
 */
export async function readClientFlight(
  bytes: Uint8Array,
  hostId: string,
  staticKey: StaticKey,
  test: HostFlightTestOptions = {},
): Promise<ReadFlight> {
  const message = splitFirstMessage(bytes);
  const extra = message.kind === SessionKind.PairCode ? concatBytes(message.sid, message.ya) : new Uint8Array(0);
  if (message.kind === SessionKind.PairCode) assertCpaceShare(message.ya);
  const pattern = message.kind === SessionKind.Session ? "IK" : "IKpsk2";
  const handshake = new Handshake({
    pattern,
    role: "responder",
    prologue: prologueFor(hostId, message.kind, extra),
    staticKey,
    ephemeralSecret: test.ephemeralSecret,
  });
  const hello = decodeHello(pattern, await handshake.readMessage(message.noise));
  const remoteStatic = handshake.remoteStatic;
  if (remoteStatic === undefined) throw new Error("message 1 carried no static key");
  return { message, handshake, hello, remoteStatic };
}

/**
 * Answers an authorized first message: for a pairing, the psk from the secret the host chose (CPace for a typed code,
 * keyed by the code), then message 2 with the LAN URLs, preceded by `Yb` for a typed code.
 */
export async function answerClientFlight(
  flight: ReadFlight,
  hostId: string,
  staticKey: StaticKey,
  secret: HostPairingSecret | undefined,
  lanUrls: readonly string[],
  test: HostFlightTestOptions = {},
): Promise<Uint8Array> {
  const { message, handshake } = flight;
  let share: Uint8Array = new Uint8Array(0);
  if (message.kind === SessionKind.PairLink) {
    if (secret?.mode !== "link") throw new Error("a link pairing needs the offer's link secret");
    handshake.setPsk(linkPairingPsk(secret.linkSecret, hostId, staticKey.publicKey));
  } else if (message.kind === SessionKind.PairCode) {
    if (secret?.mode !== "code") throw new Error("a typed-code pairing needs the offer's code");
    const inputs = { ...codePairingInputs(secret.code, hostId, staticKey.publicKey), sid: message.sid };
    const cpace = cpaceRespond(inputs, message.ya, test.cpaceScalar === undefined ? {} : { scalar: test.cpaceScalar });
    handshake.setPsk(codePairingPsk(cpace.isk));
    share = cpace.share;
  }
  return concatBytes(share, await handshake.writeMessage(encodeReply(lanUrls)));
}
