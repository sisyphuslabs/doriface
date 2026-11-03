import { CloseCode, generateX25519, PAIRING_CODE_ATTEMPTS, pairingSlotOf, rawStaticKey } from "@doriface/crypto";
import { sameSlotDecoys } from "@doriface/crypto/testing";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { chmodSync, rmSync } from "node:fs";
import { codeOf, linkOf, pairingHost, type PairingHost, runSession } from "../testing/pairing-harness.ts";
import type { E2eeTransport } from "./accept.ts";

const hosts: PairingHost[] = [];
const newHost = (): PairingHost => {
  const host = pairingHost();
  hosts.push(host);
  return host;
};
afterEach(() => {
  mock.restore();
  for (const host of hosts.splice(0)) {
    chmodSync(host.dir, 0o700);
    rmSync(host.dir, { recursive: true, force: true });
  }
});

/** Runs a session and reports how the host ended it: its close code and how many messages it had sent. */
async function refusal(run: ReturnType<typeof runSession>) {
  expect(await run.host).toBeUndefined();
  await run.client;
  return { code: run.hostEnd.closeCode, sent: run.hostEnd.sent.length };
}

/** Wrong guesses one session after another, as a relay admits them; returns how many messages the host sent each. */
async function guessOneAfterAnother(host: PairingHost, guesses: readonly string[]): Promise<readonly number[]> {
  const [guess, ...rest] = guesses;
  if (guess === undefined) return [];
  const { sent } = await refusal(runSession(host, host.relay, codeOf(host, "guesser", guess)));
  return [sent, ...(await guessOneAfterAnother(host, rest))];
}

const otherSlot = (host: PairingHost): string => (pairingSlotOf(host.offer.code) === "ZZZ" ? "YYY" : "ZZZ");

describe("typed-code attempts on the host", () => {
  test("ten wrong codes are answered and counted; the code is retired, the 11th gets 4429 unanswered, the link still pairs", async () => {
    const host = newHost();
    const answered = await guessOneAfterAnother(host, sameSlotDecoys(host.offer.code, PAIRING_CODE_ATTEMPTS));
    expect(answered).toEqual(Array.from({ length: PAIRING_CODE_ATTEMPTS }, () => 1));
    expect(host.pairing.read()?.codeAttempts).toBe(PAIRING_CODE_ATTEMPTS);
    expect(host.logs.some((line) => line.startsWith("pairing code retired after 10 failed attempts"))).toBe(true);
    expect(await refusal(runSession(host, host.relay, codeOf(host)))).toEqual({ code: CloseCode.RateLimited, sent: 0 });
    const linked = runSession(host, { kind: "lan" }, linkOf(host));
    expect(await linked.host).toBeDefined();
  });

  test("an attempt the host cannot record closes 1011 and answers nothing", async () => {
    const host = newHost();
    chmodSync(host.dir, 0o500);
    expect(await refusal(runSession(host, host.relay, codeOf(host)))).toEqual({ code: 1011, sent: 0 });
  });
});

describe("the transport gate", () => {
  test.each([
    ["the direct path", (): E2eeTransport => ({ kind: "lan" })],
    ["a relay session without ?pair", (): E2eeTransport => ({ kind: "relay" })],
    [
      "a ?pair session for another slot",
      (host: PairingHost): E2eeTransport => ({ kind: "relay", openSlot: otherSlot(host) }),
    ],
  ])("a typed-code pairing on %s is refused 4401, unanswered and uncounted", async (_, transportFor) => {
    const host = newHost();
    const run = runSession(host, transportFor(host), codeOf(host));
    expect(await refusal(run)).toEqual({ code: CloseCode.UnknownDevice, sent: 0 });
    expect(host.pairing.read()?.codeAttempts).toBe(0);
  });

  test.each([
    ["the direct path", { kind: "lan" } satisfies E2eeTransport],
    ["a relay session without ?pair", { kind: "relay" } satisfies E2eeTransport],
  ])("a typed-code pairing on %s is refused 4401 without consulting the pairing store", async (_, transport) => {
    const host = newHost();
    spyOn(host.pairing, "claimCode").mockImplementation(() => {
      throw new Error("the pairing store was consulted");
    });
    expect(await refusal(runSession(host, transport, codeOf(host)))).toEqual({
      code: CloseCode.UnknownDevice,
      sent: 0,
    });
  });

  test("a paired device's session (0x01) is refused 4401 unanswered on a ?pair session, and accepted directly", async () => {
    const host = newHost();
    const device = generateX25519();
    host.deps.devices.add(device.publicKey, "phone");
    const onPair = runSession(host, host.relay, undefined, { staticKey: rawStaticKey(device) });
    expect(await refusal(onPair)).toEqual({ code: CloseCode.UnknownDevice, sent: 0 });
    const direct = runSession(host, { kind: "lan" }, undefined, { staticKey: rawStaticKey(device) });
    expect(await direct.host).toBeDefined();
  });

  test.each([
    ["an identity CPace share", (bytes: Uint8Array) => bytes.map((byte, i) => (i >= 17 && i < 49 ? 0 : byte))],
    [
      "a corrupted message 1",
      (bytes: Uint8Array) => bytes.map((byte, i) => (i === bytes.length - 1 ? byte ^ 1 : byte)),
    ],
  ])("%s is refused 4400 before the attempt is counted", async (_, rewrite) => {
    const host = newHost();
    let first = true;
    const tap = (bytes: Uint8Array): readonly Uint8Array[] => {
      if (!first) return [bytes];
      first = false;
      return [rewrite(bytes)];
    };
    const run = runSession(host, host.relay, codeOf(host), {}, tap);
    expect(await refusal(run)).toEqual({ code: CloseCode.CryptoFailure, sent: 0 });
    expect(host.pairing.read()?.codeAttempts).toBe(0);
  });
});

describe("single use", () => {
  test("a typed-code and a link pairing confirmed together store exactly one device", async () => {
    const host = newHost();
    const [byCode, byLink] = [
      runSession(host, host.relay, codeOf(host, "a")),
      runSession(host, { kind: "lan" }, linkOf(host, "b")),
    ];
    const results = await Promise.all([byCode.host, byLink.host]);
    expect(results.filter((secure) => secure !== undefined)).toHaveLength(1);
    expect(host.deps.devices.list()).toHaveLength(1);
    expect([byCode.hostEnd.closeCode, byLink.hostEnd.closeCode]).toContain(CloseCode.UnknownDevice);
    expect(host.pairing.read()).toBeUndefined();
  });
});
