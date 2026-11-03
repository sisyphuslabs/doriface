import { describe, expect, test } from "bun:test";
import { clientFlight } from "./client-flight.ts";
import { cpaceIsk, cpaceRespond } from "./cpace.ts";
import { concatBytes, utf8 } from "./encoding.ts";
import { answerClientFlight, readClientFlight } from "./host-flight.ts";
import { generateHostIdentity, generateX25519, prologueFor } from "./identity.ts";
import { SessionKind } from "./kinds.ts";
import { Handshake } from "./noise/handshake.ts";
import { createPairingOffer } from "./pairing.ts";
import { codePairingInputs, codePairingPsk } from "./pairing-keys.ts";
import { encodePairingHello, encodeReply } from "./payloads.ts";
import { rawStaticKey } from "./static-key.ts";
import {
  type AttackerState,
  composedPairing,
  decryptsUnder,
  offlineOracle,
  sameSlotDecoys,
  v12Psk,
} from "./testing/offline-attack.ts";

const host = generateHostIdentity();
const hostKey = rawStaticKey(host.noise);
const realCode = createPairingOffer().code;
const wrongGuess = sameSlotDecoys(realCode, 1, 7)[0] ?? "";
const decoys = sameSlotDecoys(realCode, 1024);
const candidates = [realCode, wrongGuess, ...decoys];
const hostScalar = 0x5eed5eedn;

/** The C1 shape: the attacker is the initiator, commits one wrong guess, and captures the host's answer. */
async function attackerSession(guess: string) {
  const deviceKey = rawStaticKey(generateX25519());
  const ephemeralSecret = crypto.getRandomValues(new Uint8Array(32));
  const sid = crypto.getRandomValues(new Uint8Array(16));
  const flight = await clientFlight(
    {
      hostId: host.hostId,
      staticKey: deviceKey,
      remoteStatic: host.noise.publicKey,
      pairing: { mode: "code", code: guess, name: "phone" },
    },
    { ephemeralSecret, sid },
  );
  const read = await readClientFlight(flight.first, host.hostId, hostKey, { cpaceScalar: hostScalar });
  const answer = await answerClientFlight(read, host.hostId, hostKey, { mode: "code", code: realCode }, [], {
    cpaceScalar: hostScalar,
  });
  const prologue = prologueFor(host.hostId, SessionKind.PairCode, flight.first.subarray(1, 49));
  const state: AttackerState = {
    hostId: host.hostId,
    hostPub: host.noise.publicKey,
    deviceKey,
    ephemeralSecret,
    prologue,
  };
  return { flight, answer, state, message2: answer.subarray(32), ya: flight.first.subarray(17, 49), sid };
}

/** S1, the v1.2 attack: every candidate's v1.2 psk tried against message 2. Returns the candidates that decrypt it. */
async function s1Hits(state: AttackerState, message2: Uint8Array): Promise<readonly string[]> {
  const decrypts = await offlineOracle(state, message2);
  return candidates.filter((c) => decrypts(v12Psk(c)));
}

describe("the reviewer's offline attack (C1) fails against v1.3", () => {
  test("an attacker-initiated session: no candidate decrypts message 2 offline, and the committed wrong guess fails", async () => {
    const attack = await attackerSession(wrongGuess);
    expect(await s1Hits(attack.state, attack.message2)).toEqual([]);
    await expect(attack.flight.reply(attack.answer)).rejects.toThrow();
  });

  test("a passive capture with the device's Noise secrets but no CPace scalar: S1 and the raw-share mistake (S3) find nothing", async () => {
    const attack = await attackerSession(realCode);
    expect(await s1Hits(attack.state, attack.message2)).toEqual([]);
    const yb = attack.answer.subarray(0, 32);
    const empty = new Uint8Array(0);
    const rawShareKeys = [attack.ya, yb].map((k) =>
      codePairingPsk(cpaceIsk(attack.sid, k, attack.ya, empty, yb, empty)),
    );
    const s3 = await Promise.all(rawShareKeys.map((psk) => decryptsUnder(attack.state, psk, attack.message2)));
    expect(s3).toEqual([false, false]);
  });

  test("a lying lookup: the device's flight 1, forwarded to the real host, fails message 1 and is never answered", async () => {
    const impostor = generateHostIdentity();
    const flight = await clientFlight({
      hostId: host.hostId,
      staticKey: rawStaticKey(generateX25519()),
      remoteStatic: impostor.noise.publicKey,
      pairing: { mode: "code", code: realCode, name: "phone" },
    });
    await expect(readClientFlight(flight.first, host.hostId, hostKey)).rejects.toThrow();
  });
});

describe("positive controls: the harness can find a code when the composition is broken", () => {
  test("against the v1.2 composition, S1 finds exactly the real code", async () => {
    const deviceKey = rawStaticKey(generateX25519());
    const ephemeralSecret = crypto.getRandomValues(new Uint8Array(32));
    const prologue = concatBytes(utf8("doriface/1"), utf8(host.hostId));
    const v12 = { pattern: "IKpsk2", prologue } as const;
    const initiator = new Handshake({
      ...v12,
      role: "initiator",
      staticKey: deviceKey,
      remoteStatic: host.noise.publicKey,
      ephemeralSecret,
    });
    const responder = new Handshake({ ...v12, role: "responder", staticKey: hostKey, psk: v12Psk(realCode) });
    await responder.readMessage(await initiator.writeMessage(encodePairingHello("phone")));
    const message2 = await responder.writeMessage(encodeReply([]));
    const state: AttackerState = {
      hostId: host.hostId,
      hostPub: host.noise.publicKey,
      deviceKey,
      ephemeralSecret,
      prologue,
    };
    expect(await s1Hits(state, message2)).toEqual([realCode]);
  });

  test("the oracle exists: the host's real ISK decrypts the captured message 2", async () => {
    const attack = await attackerSession(wrongGuess);
    const inputs = { ...codePairingInputs(realCode, host.hostId, host.noise.publicKey), sid: attack.sid };
    const psk = codePairingPsk(cpaceRespond(inputs, attack.ya, { scalar: hostScalar }).isk);
    expect(await decryptsUnder(attack.state, psk, attack.message2)).toBe(true);
    const oracle = await offlineOracle(attack.state, attack.message2);
    expect([oracle(psk), oracle(v12Psk(wrongGuess))]).toEqual([true, false]);
  });

  test("the one online guess is real: a committed guess equal to the code pairs", async () => {
    const attack = await attackerSession(realCode);
    await expect(attack.flight.reply(attack.answer)).resolves.toBeDefined();
  });

  test("with the password dropped from the generator on both sides, the wrong committed guess pairs", async () => {
    const base = {
      hostId: host.hostId,
      hostKey,
      deviceKey: rawStaticKey(generateX25519()),
      guess: wrongGuess,
      hostCode: realCode,
    };
    expect(await composedPairing({ ...base, prsOf: utf8 })).toBe(false);
    expect(await composedPairing({ ...base, prsOf: () => new Uint8Array(0) })).toBe(true);
  });
});
