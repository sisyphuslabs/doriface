import { CloseCode, generateX25519, rawStaticKey } from "@doriface/crypto";
import { parsePolicy } from "@doriface/policy";
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, rmSync } from "node:fs";
import { codeOf, linkOf, pairingHost, type PairingHost, runSession } from "../testing/pairing-harness.ts";

const hosts: PairingHost[] = [];
const newHost = (options: Parameters<typeof pairingHost>[0] = {}): PairingHost => {
  const host = pairingHost(options);
  hosts.push(host);
  return host;
};
afterEach(() => {
  for (const host of hosts.splice(0)) {
    chmodSync(host.dir, 0o700);
    rmSync(host.dir, { recursive: true, force: true });
  }
});

/** How the host ended a session: its close code and how many messages it had sent before closing. */
async function refusal(run: ReturnType<typeof runSession>) {
  expect(await run.host).toBeUndefined();
  await run.client;
  return { code: run.hostEnd.closeCode, sent: run.hostEnd.sent.length };
}

const logged = (host: PairingHost, text: string): boolean => host.logs.some((line) => line.includes(text));

/** A host whose one plan limit is `sessions: 1`, with one device paired so a session can be authorized. */
const atSessionLimit = (live: number) => {
  const host = newHost({ live, policy: parsePolicy('{"plan":"free","limits":{"sessions":1}}') });
  const device = generateX25519();
  host.deps.devices.add(device.publicKey, "phone");
  return { host, device };
};

describe("the plan gate on pairing a device", () => {
  test("a build with no policy pairs, as it does today", async () => {
    const host = newHost();
    expect(await runSession(host, { kind: "lan" }, linkOf(host)).host).toBeDefined();
    expect(host.deps.devices.list()).toHaveLength(1);
  });

  test("a plan without pairing refuses both a link and a typed code before answering, naming the plan", async () => {
    const host = newHost({ policy: parsePolicy('{"plan":"free","withoutFeatures":["pairing"]}') });
    expect(await refusal(runSession(host, host.relay, codeOf(host)))).toEqual({
      code: CloseCode.UnknownDevice,
      sent: 0,
    });
    expect(await refusal(runSession(host, { kind: "lan" }, linkOf(host)))).toEqual({
      code: CloseCode.UnknownDevice,
      sent: 0,
    });
    expect(host.deps.devices.list()).toEqual([]);
    expect(
      host.logs.filter((line) => line === "plan: refused a pairing: The free plan does not include pairing a device."),
    ).toHaveLength(2);
  });

  test("a host at the plan's device limit refuses a new device and says what is full", async () => {
    const host = newHost({ policy: parsePolicy('{"plan":"free","limits":{"devices":1}}') });
    host.deps.devices.add(generateX25519().publicKey, "already paired");
    expect(await refusal(runSession(host, { kind: "lan" }, linkOf(host)))).toEqual({
      code: CloseCode.UnknownDevice,
      sent: 0,
    });
    expect(host.deps.devices.list()).toHaveLength(1);
    expect(
      logged(
        host,
        "plan: refused a pairing: This computer has 1 paired device, and the free plan allows 1. Remove a device to make room.",
      ),
    ).toBe(true);
  });

  test("pairing a device the host already has again needs no room", async () => {
    const host = newHost({ policy: parsePolicy('{"plan":"free","limits":{"devices":1}}') });
    const known = generateX25519();
    host.deps.devices.add(known.publicKey, "phone");
    expect(
      await runSession(host, { kind: "lan" }, linkOf(host), { staticKey: rawStaticKey(known) }).host,
    ).toBeDefined();
    expect(host.deps.devices.list()).toHaveLength(1);
  });
});

describe("the plan gate on open sessions", () => {
  test("a host at its session limit closes the next session, unanswered", async () => {
    const { host, device } = atSessionLimit(1);
    expect(await refusal(runSession(host, { kind: "lan" }, undefined, { staticKey: rawStaticKey(device) }))).toEqual({
      code: CloseCode.RateLimited,
      sent: 0,
    });
    expect(
      logged(
        host,
        "plan: refused a session: 1 session is open, and the free plan allows 1. Close a session to make room.",
      ),
    ).toBe(true);
  });

  test("the same host admits the session when the plan's room and the open sessions say so", async () => {
    const { host, device } = atSessionLimit(0);
    expect(await runSession(host, { kind: "lan" }, undefined, { staticKey: rawStaticKey(device) }).host).toBeDefined();
  });
});
