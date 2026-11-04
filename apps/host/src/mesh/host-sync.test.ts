import { describe, expect, test } from "bun:test";
import { type SecureLink, SessionKind } from "@doriface/crypto";
import { memoryLinkPair } from "@doriface/crypto/testing";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RelayProofs } from "@doriface/relay-client";
import { HostSync } from "./host-sync.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { meshOf, peer, storeOf } from "./testing/mesh-peers.ts";

/** b's running mesh with a, where every dial is recorded and fails: what matters is whom the host chose to dial. */
function hostSyncAtB(proofs?: RelayProofs) {
  const [a, b] = [peer("a"), peer("b")];
  const clock = new FakeClock();
  const dialed: string[] = [];
  const sync = new HostSync({
    identity: b.machine.identity,
    mesh: storeOf(b, meshOf([a, b]).records),
    relay: {
      url: "ws://relay.invalid",
      createSocket: (url) => {
        dialed.push(url);
        throw new Error("no relay here");
      },
      ...(proofs === undefined ? {} : { proofs }),
    },
    hc: { hc: "hc-not-installed" },
    stateDir: mkdtempSync(join(tmpdir(), "dh-host-sync-")),
    program: "/opt/doriface-host",
    openFrom: () => false,
    closeRevoked: () => undefined,
    log: () => undefined,
    clock,
    random: seededRandom(31),
  });
  return { a, clock, dialed, sync };
}

/** The session a join ran on, as HostMesh hands it over: the inviter's side received the joiner's name. */
function keptSession(peerNoise: Uint8Array, inviterSide: boolean): SecureLink {
  const [end] = memoryLinkPair(true);
  const info = {
    kind: SessionKind.PairLink,
    remoteStatic: peerNoise,
    handshakeHash: new Uint8Array(32),
    peerName: inviterSide ? "b" : undefined,
    lanUrls: [],
    stream: "mesh" as const,
  };
  return Object.assign(end, info);
}

describe("a join's kept session (section 4.4, M-D1)", () => {
  test.each([
    ["the joiner's side", false],
    ["the inviter's side", true],
  ])("%s is attached before the host dials, so the start sweep and the pushes go over it", async (_side, inviter) => {
    const { a, clock, dialed, sync } = hostSyncAtB();
    sync.adopt(keptSession(a.machine.identity.noise.publicKey, inviter));
    await clock.advance(1);
    expect(dialed.filter((url) => url.includes(a.hostId))).toEqual([]);
    sync.stop();
  });
});

describe("this host's own uplink returning (section 5.1)", () => {
  test("after a drop of more than 2 minutes the host sweeps with a member; after a short one it does not", async () => {
    const { a, clock, dialed, sync } = hostSyncAtB();
    sync.changed();
    sync.uplinkDropped();
    await clock.advance(60_000);
    const beforeShort = dialed.length;
    sync.uplinkAnswered();
    await clock.advance(1);
    expect(dialed.length).toBe(beforeShort);
    sync.uplinkDropped();
    await clock.advance(121_000);
    const beforeAnswer = dialed.length;
    sync.uplinkAnswered();
    await clock.advance(1);
    expect(dialed.slice(beforeAnswer).some((url) => url.includes(a.hostId))).toBe(true);
    await sync.stop();
  });
});

describe("a host that keeps no relay uplink (M-D3)", () => {
  test("dials no member at all: nothing reaches a relay it was not given", async () => {
    const [a, b] = [peer("a"), peer("b")];
    const clock = new FakeClock();
    const dialed: string[] = [];
    const logs: string[] = [];
    const sync = new HostSync({
      identity: b.machine.identity,
      mesh: storeOf(b, meshOf([a, b]).records),
      relay: {
        url: undefined,
        createSocket: (url) => {
          dialed.push(url);
          throw new Error("no relay here");
        },
      },
      hc: { hc: "hc-not-installed" },
      stateDir: mkdtempSync(join(tmpdir(), "dh-host-sync-")),
      program: "/opt/doriface-host",
      openFrom: () => false,
      closeRevoked: () => undefined,
      log: (line) => void logs.push(line),
      clock,
      random: seededRandom(37),
    });
    sync.changed();
    sync.uplinkDropped();
    await clock.advance(121_000);
    sync.uplinkAnswered();
    await clock.advance(1);
    expect(dialed).toEqual([]);
    expect(logs.some((line) => line.includes("no relay"))).toBe(true);
    sync.stop();
  });
});

describe("a new relay pass (contract v1.6)", () => {
  test("makes a member whose dial was refused for its pass due again", async () => {
    const passListeners: ((origin: string) => void)[] = [];
    const proofs: RelayProofs = {
      presents: () => false,
      proof: () => undefined,
      received: () => undefined,
      refused: () => undefined,
      accepted: () => undefined,
      wantsPass: () => false,
      onWant: () => () => undefined,
      onPass: (listener) => {
        passListeners.push(listener);
        return () => undefined;
      },
    };
    const { a, clock, dialed, sync } = hostSyncAtB(proofs);
    sync.changed();
    await clock.advance(1);
    // The start sweep's dial failed (no relay here) and gated a as offline; a session from it clears that first.
    const policy = sync.runtime?.policy;
    expect(policy).toBeDefined();
    policy?.report(a.signPub, "connected");
    policy?.report(a.signPub, 4412);
    const before = dialed.length;
    for (const listener of passListeners) listener("ws://relay.invalid");
    await clock.advance(2_001);
    expect(dialed.slice(before).some((url) => url.includes(a.hostId))).toBe(true);
    await sync.stop();
  });
});
