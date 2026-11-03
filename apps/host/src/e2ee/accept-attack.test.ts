import { CloseCode, generateX25519, prologueFor, rawStaticKey, SessionKind } from "@doriface/crypto";
import { type AttackerState, decryptsUnder, sameSlotDecoys, v12Psk } from "@doriface/crypto/testing";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rmSync } from "node:fs";
import { codeOf, pairingHost, runSession } from "../testing/pairing-harness.ts";

/** The S1 search runs 1026 handshakes; a loaded host can take longer than bun's 5 s default. */
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
    const candidates = [host.offer.code, wrongGuess, ...sameSlotDecoys(host.offer.code, 1024)];
    const tried = await Promise.all(candidates.map((c) => decryptsUnder(state, v12Psk(c), answer.subarray(32))));
    expect(tried.filter(Boolean)).toHaveLength(0);
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
