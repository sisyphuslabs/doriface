import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloseCode, type RelayProofs, relayOriginOf } from "@doriface/relay-client";
import type { Server } from "bun";
import { openRelayPasses } from "../relay/relay-passes.ts";
import { HostSync } from "./host-sync.ts";
import { FakeClock, seededRandom } from "./testing/fake-clock.ts";
import { meshOf, peer, storeOf } from "./testing/mesh-peers.ts";

/**
 * Contract v1.6, 3.6, composed as the running host composes it (#162): HostSync's member dial runs the real
 * `connectRelayClient` with the host's real PassBook, wrapped in `withPassRetry`, against a local relay that refuses
 * the proven session with 4412 once the dialer's Noise handshake has started on it.
 */

const DAY_S = 24 * 60 * 60;
/** `version u8 || pass (58) || ...`: the pass a proof carries. */
const PASS_AT = 1;
const PASS_BYTES = 58;

/** A session upgrade as the relay saw it, once the dialer's handshake had started on it. */
interface Upgrade {
  /** The pass the upgrade's proof carried (hex), or undefined for an upgrade without a proof. */
  readonly pass: string | undefined;
  close(code: number, reason: string): void;
}

interface Data {
  readonly proof: string | null;
  started: boolean;
}

const servers: Server<Data>[] = [];
afterAll(() => {
  for (const server of servers) void server.stop(true);
});

const nothing = (): void => undefined;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const passOfProof = (proof: string | null): string | undefined =>
  proof === null ? undefined : hex(Buffer.from(proof, "base64url").subarray(PASS_AT, PASS_AT + PASS_BYTES));

/** A relay that hands every session upgrade to the test, in order, and lets the test close it. */
function localRelay(): { readonly url: string; next(): Promise<Upgrade> } {
  const queued: Upgrade[] = [];
  const waiting: ((upgrade: Upgrade) => void)[] = [];
  const server = Bun.serve<Data>({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, bun) => {
      const data = { proof: new URL(request.url).searchParams.get("proof"), started: false };
      return bun.upgrade(request, { data }) ? undefined : new Response("upgrade", { status: 426 });
    },
    websocket: {
      // The dialer's first handshake message: the session is open and HostSync's handshake listens on it.
      message: (ws) => {
        if (ws.data.started) return;
        ws.data.started = true;
        const upgrade = { pass: passOfProof(ws.data.proof), close: (code: number, why: string) => ws.close(code, why) };
        const waiter = waiting.shift();
        if (waiter === undefined) queued.push(upgrade);
        else waiter(upgrade);
      },
    },
  });
  servers.push(server);
  return {
    url: `http://127.0.0.1:${server.port}`,
    next: () => {
      const upgrade = queued.shift();
      return upgrade === undefined ? new Promise((resolve) => waiting.push(resolve)) : Promise.resolve(upgrade);
    },
  };
}

/** A pass for the host whose Ed25519 key is `signPub`, valid for 30 days; `fill` tells passes apart. */
async function passFor(signPub: Uint8Array, fill: number): Promise<Uint8Array<ArrayBuffer>> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", signPub.slice()));
  const pass = new Uint8Array(PASS_BYTES);
  const view = new DataView(pass.buffer);
  const now = Math.floor(Date.now() / 1000);
  view.setUint8(0, 1);
  view.setUint8(1, 1);
  view.setUint32(2, now);
  view.setUint32(6, now + 30 * DAY_S);
  pass.set(digest.subarray(0, 16), 10);
  pass.fill(fill, 26);
  return pass;
}

/** Host b, holding `held`, about to dial member a through the local relay. */
async function dialer() {
  const [a, b] = [peer("a"), peer("b")];
  const relay = localRelay();
  const origin = relayOriginOf(relay.url);
  const stateDir = mkdtempSync(join(tmpdir(), "dh-host-sync-passes-"));
  const book = await openRelayPasses(stateDir, b.machine.identity, () => undefined);
  const [older, newer] = await Promise.all([
    passFor(b.machine.identity.sign.publicKey, 1),
    passFor(b.machine.identity.sign.publicKey, 2),
  ]);
  const receive = (pass: Uint8Array<ArrayBuffer>): void => book.received(origin, { relayNowMs: Date.now(), pass });
  receive(older);
  // The real PassBook, observed: `withPassRetry` subscribes to new passes only while it waits for one.
  let subscriptions = 0;
  let wants = 0;
  let onWait = nothing;
  book.onWant(() => void (wants += 1));
  const proofs: RelayProofs = {
    presents: (relayOrigin) => book.presents(relayOrigin),
    proof: (role, target, relayOrigin) => book.proof(role, target, relayOrigin),
    received: (relayOrigin, frame) => book.received(relayOrigin, frame),
    refused: (relayOrigin, proof) => book.refused(relayOrigin, proof),
    accepted: (relayOrigin) => book.accepted(relayOrigin),
    wantsPass: (relayOrigin) => book.wantsPass(relayOrigin),
    onWant: (listener) => book.onWant(listener),
    onPass: (listener) => {
      subscriptions += 1;
      const stop = book.onPass(listener);
      queueMicrotask(() => onWait());
      return stop;
    },
  };
  const ended = Promise.withResolvers<string>();
  const sync = new HostSync({
    identity: b.machine.identity,
    mesh: storeOf(b, meshOf([a, b]).records),
    relay: { url: relay.url, proofs },
    hc: { hc: "hc-not-installed" },
    stateDir,
    program: "/opt/doriface-host",
    openFrom: () => false,
    closeRevoked: () => undefined,
    log: (line) => {
      if (line.startsWith("mesh: sync with a failed")) ended.resolve(line);
    },
    clock: new FakeClock(),
    random: seededRandom(162),
  });
  const ownSubscriptions = subscriptions;
  return {
    sync,
    book,
    origin,
    older: hex(older),
    newer: hex(newer),
    receiveNewer: () => receive(newer),
    whenWaiting: (deliver: () => void) => void (onWait = deliver),
    waits: () => subscriptions - ownSubscriptions,
    wants: () => wants,
    ended: ended.promise,
    /** The next session upgrade; a dial that ends before making one fails the test with its reason. */
    next: () =>
      Promise.race([
        relay.next(),
        ended.promise.then((line) => Promise.reject(new Error(`no further upgrade, the dial ended: ${line}`))),
      ]),
  };
}

describe("a member dial refused for its pass, composed (contract v1.6, 3.6)", () => {
  test("a refusal of the held pass waits for the new pass the uplink asked for, then redials once with it", async () => {
    const host = await dialer();
    host.whenWaiting(host.receiveNewer);
    host.sync.changed();
    const first = await host.next();
    expect(first.pass).toBe(host.older);
    first.close(CloseCode.PassRefused, "relay pass refused");
    const second = await host.next();
    expect(second.pass).toBe(host.newer);
    expect(host.wants()).toBe(1);
    expect(host.waits()).toBe(1);
    // The relay never closes a third upgrade, so the dial ending here means it redialed only once.
    second.close(4404, "host offline");
    await host.ended;
    await host.sync.stop();
  });

  test("a refusal of an older pass, a newer one held, redials at once with a proof carrying the newer pass", async () => {
    const host = await dialer();
    host.sync.changed();
    const first = await host.next();
    expect(first.pass).toBe(host.older);
    host.receiveNewer();
    first.close(CloseCode.PassRefused, "relay pass refused");
    const second = await host.next();
    expect(second.pass).toBe(host.newer);
    expect(host.waits()).toBe(0);
    expect(host.wants()).toBe(0);
    expect(host.book.presents(host.origin)).toBe(true);
    // The relay never closes a third upgrade, so the dial ending here means it redialed only once.
    second.close(4404, "host offline");
    await host.ended;
    await host.sync.stop();
  });
});
