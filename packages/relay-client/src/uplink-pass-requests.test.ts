import { afterAll, afterEach, describe, expect, jest, test } from "bun:test";
import { PassBook, type PassStore, type StoredPass } from "./pass-book.ts";
import { ed25519Signer, generateSigningKey } from "./signer.ts";
import { UplinkPasses } from "./uplink-passes.ts";
import { encodePassRequest, PASS_BYTES } from "./wire/index.ts";

const ORIGIN = "wss://relay.example";
const HOST_ID = "a".repeat(26);
const NOW_MS = 1_800_000_000_000;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request, srv) => (srv.upgrade(request) ? undefined : new Response("upgrade", { status: 426 })),
  websocket: { message: () => undefined },
});
afterAll(() => server.stop(true));
afterEach(() => jest.useRealTimers());

function memoryStore(): PassStore {
  let passes: ReadonlyMap<string, StoredPass> = new Map();
  return { load: () => passes, save: (next) => (passes = new Map(next)) };
}

/** A PASS frame's payload (relay clock, then the 58-byte pass) issued to the host that owns `secretKey`. */
async function passPayload(secretKey: Uint8Array): Promise<Uint8Array> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ed25519Signer(secretKey).publicKey));
  const payload = new Uint8Array(8 + PASS_BYTES);
  const view = new DataView(payload.buffer);
  view.setBigUint64(0, BigInt(NOW_MS));
  view.setUint8(8, 1);
  view.setUint8(9, 1);
  view.setUint32(10, NOW_MS / 1000);
  view.setUint32(14, NOW_MS / 1000 + 30 * 24 * 60 * 60);
  payload.set(digest.subarray(0, 16), 18);
  return payload;
}

/**
 * An uplink's pass side on an open socket whose sends are recorded, with fake timers from here on: every request the
 * side schedules runs only when the test advances the clock, so "nothing was sent" never rests on timer order.
 */
type Sent = Parameters<WebSocket["send"]>[0];

async function openSide(): Promise<{ book: PassBook; passes: UplinkPasses; payload: Uint8Array; sent: Sent[] }> {
  const secretKey = generateSigningKey();
  const book = await PassBook.create({ secretKey, store: memoryStore(), now: () => NOW_MS });
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const sent: Sent[] = [];
  ws.send = (data) => void sent.push(data);
  jest.useFakeTimers();
  const passes = new UplinkPasses(book, ORIGIN, HOST_ID, () => 0);
  passes.attempting(ws);
  return { book, passes, payload: await passPayload(secretKey), sent };
}

/** The host's proof on its held pass, and that pass refused by the relay. */
function refuseHeldPass(book: PassBook): void {
  book.refused(ORIGIN, book.proof("host", HOST_ID, ORIGIN) ?? "");
}

describe("pass requests on the uplink (contract v1.6)", () => {
  test("after a refusal, an uplink that had a PASS frame asks for a new pass at once, exactly once", async () => {
    const { book, passes, payload, sent } = await openSide();
    expect(passes.frame(payload)).toBe(true);
    refuseHeldPass(book);
    jest.advanceTimersByTime(0);
    expect(sent).toEqual([encodePassRequest()]);
    jest.advanceTimersByTime(64_999);
    expect(sent).toHaveLength(1);
    passes.stop();
  });

  test("an uplink that got no PASS frame (an old relay) never sends a request, however long it runs", async () => {
    const { book, passes, payload, sent } = await openSide();
    book.received(ORIGIN, { relayNowMs: NOW_MS, pass: payload.slice(8) });
    refuseHeldPass(book);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(24 * 60 * 60_000);
    expect(sent).toEqual([]);
    passes.stop();
  });
});
