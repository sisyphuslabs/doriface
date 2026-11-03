import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { cpaceInitiate, cpaceRespond } from "../cpace.ts";
import { concatBytes, utf8 } from "../encoding.ts";
import { prologueFor, x25519FromSecret } from "../identity.ts";
import { SessionKind } from "../kinds.ts";
import { Handshake, PROTOCOL_NAMES } from "../noise/handshake.ts";
import { SymmetricState } from "../noise/symmetric-state.ts";
import { codePairingCi, codePairingPsk } from "../pairing-keys.ts";
import { PAIRING_ALPHABET, pairingSlotOf } from "../pairing.ts";
import { encodePairingHello, encodeReply } from "../payloads.ts";
import type { StaticKey } from "../static-key.ts";

/** The v1.2 psk (HKDF-SHA256 of the code), which is exactly what the C1 attack tries for every candidate. */
export const v12Psk = (code: string): Uint8Array =>
  hkdf(sha256, utf8(code), new Uint8Array(0), utf8("doriface pair v1"), 32);

/** `count` distinct codes on `code`'s slot, drawn from a seeded xorshift so every run tests the same decoys. */
export function sameSlotDecoys(code: string, count: number, seed = 0x2545f491): readonly string[] {
  const slot = pairingSlotOf(code);
  const out = new Set<string>();
  let state = seed;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  while (out.size < count) {
    const secret = Array.from({ length: 5 }, () => PAIRING_ALPHABET.charAt(next() & 31)).join("");
    if (`${slot}${secret}` !== code) out.add(`${slot}${secret}`);
  }
  return [...out];
}

/** What an attacker who ran its own initiator knows: its static key, its ephemeral secret and the prologue. */
export interface AttackerState {
  readonly hostId: string;
  readonly hostPub: Uint8Array;
  readonly deviceKey: StaticKey;
  readonly ephemeralSecret: Uint8Array;
  readonly prologue: Uint8Array;
}

/**
 * Re-runs the attacker's own initiator with a candidate psk and tries message 2 under it: true when message 2
 * decrypts, which is what "testing a guess offline" means.
 */
export async function decryptsUnder(state: AttackerState, psk: Uint8Array, message2: Uint8Array): Promise<boolean> {
  const handshake = new Handshake({
    pattern: "IKpsk2",
    role: "initiator",
    prologue: state.prologue,
    staticKey: state.deviceKey,
    remoteStatic: state.hostPub,
    ephemeralSecret: state.ephemeralSecret,
  });
  await handshake.writeMessage(encodePairingHello("phone"));
  handshake.setPsk(psk);
  return handshake.readMessage(message2).then(
    () => true,
    () => false,
  );
}

/**
 * The same test as {@link decryptsUnder}, for many candidates against one captured message 2. Every Diffie-Hellman
 * in the replay depends only on the attacker's own keys and the host's ephemeral, never on the psk (IKpsk2 mixes it
 * last), so the four DHs run once here and each candidate costs only the symmetric steps. The positive controls hold
 * this oracle and the full-`Handshake` replay to the same answers.
 */
export async function offlineOracle(state: AttackerState, message2: Uint8Array): Promise<(psk: Uint8Array) => boolean> {
  const e = x25519FromSecret(state.ephemeralSecret);
  const re = message2.subarray(0, 32);
  const es = x25519.getSharedSecret(e.secretKey, state.hostPub);
  const ss = await state.deviceKey.dh(state.hostPub);
  const ee = x25519.getSharedSecret(e.secretKey, re);
  const se = await state.deviceKey.dh(re);
  const hello = encodePairingHello("phone");
  return (psk) => {
    const symmetric = new SymmetricState(PROTOCOL_NAMES.IKpsk2);
    symmetric.mixHash(state.prologue);
    symmetric.mixHash(state.hostPub);
    symmetric.mixHash(e.publicKey);
    symmetric.mixKey(e.publicKey);
    symmetric.mixKey(es);
    symmetric.encryptAndHash(state.deviceKey.publicKey);
    symmetric.mixKey(ss);
    symmetric.encryptAndHash(hello);
    symmetric.mixHash(re);
    symmetric.mixKey(re);
    symmetric.mixKey(ee);
    symmetric.mixKey(se);
    symmetric.mixKeyAndHash(psk);
    try {
      symmetric.decryptAndHash(message2.subarray(32));
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * A typed-code pairing composed by hand, so a test can drop the password from the CPace generator on both sides (the
 * failure class the offline-attack suite must be able to detect). With `prs` = the code it matches the real protocol.
 */
export async function composedPairing(opts: {
  readonly hostId: string;
  readonly hostKey: StaticKey;
  readonly deviceKey: StaticKey;
  readonly prsOf: (code: string) => Uint8Array;
  readonly guess: string;
  readonly hostCode: string;
}): Promise<boolean> {
  const sid = crypto.getRandomValues(new Uint8Array(16));
  const ci = codePairingCi(opts.hostId, opts.hostKey.publicKey, pairingSlotOf(opts.hostCode));
  const device = cpaceInitiate({ prs: opts.prsOf(opts.guess), ci, sid });
  const prologue = prologueFor(opts.hostId, SessionKind.PairCode, concatBytes(sid, device.share));
  const role = { pattern: "IKpsk2", prologue } as const;
  const initiator = new Handshake({
    ...role,
    role: "initiator",
    staticKey: opts.deviceKey,
    remoteStatic: opts.hostKey.publicKey,
  });
  const responder = new Handshake({ ...role, role: "responder", staticKey: opts.hostKey });
  await responder.readMessage(await initiator.writeMessage(encodePairingHello("phone")));
  const host = cpaceRespond({ prs: opts.prsOf(opts.hostCode), ci, sid }, device.share);
  responder.setPsk(codePairingPsk(host.isk));
  const message2 = await responder.writeMessage(encodeReply([]));
  initiator.setPsk(codePairingPsk(device.finish(host.share)));
  return initiator.readMessage(message2).then(
    () => true,
    () => false,
  );
}
