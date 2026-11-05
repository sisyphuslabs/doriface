import { CloseCode, generateX25519, prologueFor, rawStaticKey, SessionKind } from "@doriface/crypto";
import { type AttackerState, decryptsUnder, offlineOracle, sameSlotDecoys, v12Psk } from "@doriface/crypto/testing";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rmSync } from "node:fs";
import { codeOf, pairingHost, runSession } from "../testing/pairing-harness.ts";

/** Each case starts a real pairing session on the host; a heavily loaded machine can stretch that past bun's 5 s default. */
setDefaultTimeout(30_000);

const host = pairingHost();
afterAll(() => rmSync(host.dir, { recursive: true, force: true }));

describe("the C1 offline attack against a real host", () => {
  test("a captured answer to a wrong guess decrypts under no candidate, and costs exactly one attempt", async () => {
    const wrongGuess = sameSlotDecoys(host.offer.code, 1, 11)[0] ?? "";
    const deviceKey = rawStaticKey(generateX25519());
    const ephemeralSecret = crypto.getRandomValues(new Uint8Array(32));
    const sid = crypto.getRandomValues(new Uint8Array(16));
    const run = runSession(host, host.relay, codeOf(host, "attacker", wrongGuess), {
      staticKey: deviceKey,
      testRandomness: { ephemeralSecret, sid },
    });
    expect(await run.client).toBeUndefined();
    await run.host;
    const [flight1] = run.clientEnd.sent;
    const [answer] = run.hostEnd.sent;
    if (flight1 === undefined || answer === undefined) throw new Error("no exchange was captured");
    const state: AttackerState = {
      hostId: host.deps.identity.hostId,
      hostPub: host.deps.identity.noise.publicKey,
      deviceKey,
      ephemeralSecret,
      prologue: prologueFor(host.deps.identity.hostId, SessionKind.PairCode, flight1.subarray(1, 49)),
    };
    // The S1 search as the crypto suite runs it (#427): the psk-independent Diffie-Hellmans once, then only the symmetric
    // steps per candidate. A full handshake replay per candidate redoes four X25519s each, ~15x the CPU, all on one
    // thread, so under load the case waited out its timeout in the run queue. The two candidates that matter are
    // replayed in full too, so this oracle answers for this host's real handshake.
    const decrypts = await offlineOracle(state, answer.subarray(32));
    const replayed = [host.offer.code, wrongGuess];
    const full = await Promise.all(replayed.map((c) => decryptsUnder(state, v12Psk(c), answer.subarray(32))));
    expect(replayed.map((c) => decrypts(v12Psk(c)))).toEqual(full);
    const candidates = [...replayed, ...sameSlotDecoys(host.offer.code, 1024)];
    expect(candidates.filter((c) => decrypts(v12Psk(c)))).toEqual([]);
    expect(host.pairing.read()?.codeAttempts).toBe(1);
  });

  test("a v1.2-shaped first message is closed 4400 and never answered", async () => {
    const v12 = crypto.getRandomValues(new Uint8Array(131));
    v12[0] = SessionKind.PairLink;
    const run = runSession(host, host.relay, codeOf(host), {}, () => [v12]);
    expect(await run.host).toBeUndefined();
    expect([run.hostEnd.closeCode, run.hostEnd.sent.length]).toEqual([CloseCode.CryptoFailure, 0]);
    await run.client;
  });
});
