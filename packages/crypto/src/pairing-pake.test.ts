import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";
import { clientFlight, type PairingSecret } from "./client-flight.ts";
import { CpaceError } from "./cpace.ts";
import { concatBytes, utf8 } from "./encoding.ts";
import { generateHostIdentity, generateX25519, x25519FromSecret } from "./identity.ts";
import { SessionKind } from "./kinds.ts";
import { CloseCode } from "./link.ts";
import { DecryptError } from "./noise/cipher-state.ts";
import { Handshake } from "./noise/handshake.ts";
import { createPairingOffer } from "./pairing.ts";
import { encodePairingHello, encodeSessionHello, PayloadError } from "./payloads.ts";
import { secureLink } from "./secure-link.ts";
import { rawStaticKey } from "./static-key.ts";
import { memoryLinkPair } from "./testing/memory-link.ts";
import { acceptAll, codePairing, connect, host, offer, settledError } from "./testing/secure-link-fixture.ts";

/** A responder that records every authorize call, for first messages sent by hand. */
function respond(hostId = host.hostId, noise = host.noise) {
  const [clientEnd, hostEnd] = memoryLinkPair();
  const asked: number[] = [];
  const responder = secureLink(hostEnd, {
    role: "responder",
    hostId,
    staticKey: rawStaticKey(noise),
    authorize: (hello) => (asked.push(hello.kind), acceptAll(hello)),
  });
  return { clientEnd, hostEnd, responder, asked };
}

/** The cause a refused first message failed with: which check stopped it. */
async function causeOf(first: Uint8Array): Promise<{ readonly cause: unknown; readonly answered: number }> {
  const run = respond();
  run.clientEnd.send(first);
  const error = await settledError(run.responder);
  expect(error.code).toBe(CloseCode.CryptoFailure);
  expect(run.asked).toEqual([]);
  return { cause: error.cause, answered: run.hostEnd.sent.length };
}

describe("typed-code pairing binds the host and the slot", () => {
  test("a wrong code fails on the device at message 2, and the host answered exactly once", async () => {
    const pair = connect({ pairing: codePairing("phone", createPairingOffer().code) });
    expect((await settledError(pair.initiator)).code).toBe(CloseCode.CryptoFailure);
    expect(pair.hostEnd.sent).toHaveLength(1);
    expect((await settledError(pair.responder)).code).toBe(CloseCode.CryptoFailure);
  });

  test.each([
    ["another hostId", () => ({ hostId: generateHostIdentity().hostId, key: host.noise.publicKey })],
    ["another host static key", () => ({ hostId: host.hostId, key: generateX25519().publicKey })],
  ])("a device given %s cannot pair with this host", async (_, given) => {
    const { hostId, key } = given();
    const flight = await clientFlight({
      hostId,
      staticKey: rawStaticKey(generateX25519()),
      remoteStatic: key,
      pairing: codePairing("phone"),
    });
    const run = respond();
    run.clientEnd.send(flight.first);
    expect((await settledError(run.responder)).code).toBe(CloseCode.CryptoFailure);
    expect(run.hostEnd.sent).toEqual([]);
  });

  test("a code for another slot gives another CPace generator, so message 2 fails on the device", async () => {
    const other = `${offer.code.startsWith("Z") ? "Y" : "Z"}${offer.code.slice(1)}`;
    const pair = connect({ pairing: codePairing("phone", other) });
    expect((await settledError(pair.initiator)).code).toBe(CloseCode.CryptoFailure);
    await settledError(pair.responder);
  });

  test("an honest flight 1 with its CPace share swapped fails message 1 under the prologue", async () => {
    const flight = await clientFlight({
      hostId: host.hostId,
      staticKey: rawStaticKey(generateX25519()),
      remoteStatic: host.noise.publicKey,
      pairing: codePairing("phone"),
    });
    const other = await clientFlight({
      hostId: host.hostId,
      staticKey: rawStaticKey(generateX25519()),
      remoteStatic: host.noise.publicKey,
      pairing: codePairing("phone"),
    });
    const spliced = concatBytes(flight.first.subarray(0, 17), other.first.subarray(17, 49), flight.first.subarray(49));
    const { cause, answered } = await causeOf(spliced);
    expect(cause).toBeInstanceOf(DecryptError);
    expect(answered).toBe(0);
  });
});

const REPLY_BOUNDS: readonly [string, PairingSecret | undefined, number][] = [
  ["a session reply of 305 bytes", undefined, 305],
  ["a pair-code reply of 337 bytes", codePairing("phone"), 337],
  ["a pair-code reply of 79 bytes", codePairing("phone"), 79],
  ["a pair-link reply of 47 bytes", { mode: "link", linkSecret: offer.linkSecret, name: "phone" }, 47],
];

describe("host replies outside the contract's size bounds", () => {
  test.each(REPLY_BOUNDS)(
    "%s is refused by the size gate before the share or message 2 is read",
    async (_, pairing, size) => {
      const flight = await clientFlight({
        hostId: host.hostId,
        staticKey: rawStaticKey(generateX25519()),
        remoteStatic: host.noise.publicKey,
        pairing,
      });
      await expect(flight.reply(new Uint8Array(size).fill(1))).rejects.toBeInstanceOf(PayloadError);
    },
  );
});

describe("first messages the host never answers", () => {
  test.each([
    ["an unknown kind", concatBytes(Uint8Array.of(0x07), new Uint8Array(150))],
    ["a truncated pair-code message (163 bytes)", concatBytes(Uint8Array.of(0x02), new Uint8Array(162))],
    ["an oversize pair-code message (402 bytes)", concatBytes(Uint8Array.of(0x02), new Uint8Array(401))],
  ])("%s is refused by the size and kind gate", async (_, first) => {
    const { cause, answered } = await causeOf(first);
    expect(cause).toBeInstanceOf(PayloadError);
    expect(answered).toBe(0);
  });

  test("an identity CPace share is refused before message 1 is read", async () => {
    const flight = await clientFlight({
      hostId: host.hostId,
      staticKey: rawStaticKey(generateX25519()),
      remoteStatic: host.noise.publicKey,
      pairing: codePairing("phone"),
    });
    const identity = concatBytes(flight.first.subarray(0, 17), new Uint8Array(32), flight.first.subarray(49));
    const { cause, answered } = await causeOf(identity);
    expect(cause).toBeInstanceOf(CpaceError);
    expect(answered).toBe(0);
  });
});

/** A v1.2 message 1 (no kind byte, v1.2 prologue) whose ephemeral key starts with `firstByte`. */
function ephemeralStartingWith(firstByte: number): Uint8Array {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return x25519FromSecret(secret).publicKey[0] === firstByte ? secret : ephemeralStartingWith(firstByte);
}

async function v12Message(pattern: "IK" | "IKpsk2", firstByte: number, payload: Uint8Array): Promise<Uint8Array> {
  const psk = hkdf(sha256, utf8(offer.code), new Uint8Array(0), utf8("doriface pair v1"), 32);
  const handshake = new Handshake({
    pattern,
    role: "initiator",
    prologue: concatBytes(utf8("doriface/1"), utf8(host.hostId)),
    staticKey: rawStaticKey(generateX25519()),
    remoteStatic: host.noise.publicKey,
    psk: pattern === "IKpsk2" ? psk : undefined,
    ephemeralSecret: ephemeralStartingWith(firstByte),
  });
  return handshake.writeMessage(payload);
}

describe("v1.2 first messages are never answered", () => {
  const longName = encodePairingHello("x".repeat(50));

  test("one that reads as kind 0x01 fails at the size gate, or at message 1 once early bytes make it long enough", async () => {
    const bare = await causeOf(await v12Message("IK", 0x01, encodeSessionHello()));
    expect(bare.cause).toBeInstanceOf(PayloadError);
    const early = await causeOf(await v12Message("IK", 0x01, encodeSessionHello(new Uint8Array(40))));
    expect(early.cause).toBeInstanceOf(DecryptError);
    expect([bare.answered, early.answered]).toEqual([0, 0]);
  });

  test("one that reads as kind 0x03 and passes its size bounds fails message 1 under the v1.3 prologue", async () => {
    const { cause, answered } = await causeOf(await v12Message("IKpsk2", 0x03, encodePairingHello("phone")));
    expect(cause).toBeInstanceOf(DecryptError);
    expect(answered).toBe(0);
  });

  test("one that reads as kind 0x02 fails before any answer: at the size gate, the share check or message 1", async () => {
    const short = await causeOf(await v12Message("IKpsk2", 0x02, encodePairingHello("phone")));
    expect(short.cause).toBeInstanceOf(PayloadError);
    const long = await causeOf(await v12Message("IKpsk2", 0x02, longName));
    expect(long.cause instanceof CpaceError || long.cause instanceof DecryptError).toBe(true);
    expect([short.answered, long.answered]).toEqual([0, 0]);
  });

  test("one with any other first byte is an unknown kind", async () => {
    const { cause, answered } = await causeOf(await v12Message("IKpsk2", 0x09, encodePairingHello("phone")));
    expect(cause).toBeInstanceOf(PayloadError);
    expect(answered).toBe(0);
  });
});

describe("session kinds", () => {
  test("each kind's first message starts with its kind byte", async () => {
    const base = { hostId: host.hostId, staticKey: rawStaticKey(generateX25519()), remoteStatic: host.noise.publicKey };
    const kinds = await Promise.all([
      clientFlight(base),
      clientFlight({ ...base, pairing: codePairing("phone") }),
      clientFlight({ ...base, pairing: { mode: "link", linkSecret: offer.linkSecret, name: "phone" } }),
    ]);
    expect(kinds.map((flight) => flight.first[0])).toEqual([
      SessionKind.Session,
      SessionKind.PairCode,
      SessionKind.PairLink,
    ]);
    expect(kinds[1]?.first.byteLength).toBe(1 + 16 + 32 + 32 + 48 + 23 + 16);
  });
});
