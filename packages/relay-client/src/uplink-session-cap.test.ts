import { afterAll, expect, test } from "bun:test";
import { RelayCloseError } from "./link.ts";
import type { SessionLink } from "./session-link.ts";
import { ed25519Signer, generateSigningKey } from "./signer.ts";
import { Uplink, type SessionRefusal } from "./uplink.ts";
import { decodeMux, encodeClose, encodeData, encodeOpen, MuxType } from "./wire/index.ts";

/** Resolves `until(key)` once `record(key, value)` has happened, before or after the call. */
function events<T>() {
  const seen = new Map<string, T>();
  const waiting = new Map<string, (value: T) => void>();
  return {
    seen,
    record: (key: string, value: T): void => {
      seen.set(key, value);
      waiting.get(key)?.(value);
    },
    until: (key: string): Promise<T> => {
      const found = seen.get(key);
      if (found !== undefined) return Promise.resolve(found);
      return new Promise((resolve) => waiting.set(key, resolve));
    },
  };
}

const ids = (from: number, count: number): number[] => Array.from({ length: count }, (_, index) => from + index);

const fromHost = events<number>();
const answered = Promise.withResolvers<(bytes: Uint8Array) => void>();
const relay = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("upgrade", { status: 426 })),
  websocket: {
    open: (ws) => {
      ws.send(new Uint8Array(32));
    },
    message: (ws, message) => {
      if (typeof message === "string") return;
      if (message.byteLength === 96) return answered.resolve((bytes) => ws.send(bytes));
      const frame = decodeMux(message);
      if (frame.type === MuxType.Data) fromHost.record(`data ${frame.sessionId}`, 0);
      if (frame.type === MuxType.Close) fromHost.record(`close ${frame.sessionId}`, frame.code);
    },
  },
});
afterAll(() => relay.stop(true));

test("the host holds at most 8 pending and 32 active relay sessions, whatever the relay opens", async () => {
  const sessions = events<SessionLink>();
  const refused: SessionRefusal[] = [];
  const uplink = await Uplink.start({
    relayUrl: `http://127.0.0.1:${relay.port}`,
    signer: ed25519Signer(generateSigningKey()),
    credit: false,
    onSession: (session) => sessions.record(`${session.sessionId}`, session),
    onRefused: (refusal) => refused.push(refusal),
  });
  try {
    const send = await answered.promise;
    const open = (batch: readonly number[]): Promise<SessionLink[]> => {
      for (const id of batch) send(encodeOpen(id));
      return Promise.all(batch.map((id) => sessions.until(`${id}`)));
    };
    /** The host's first DATA on a session makes it active (contract "Session admission"). */
    const answer = async (links: readonly SessionLink[]): Promise<void> => {
      await Promise.all(links.map((link) => link.send(new Uint8Array([1]))));
      await Promise.all(links.map((link) => fromHost.until(`data ${link.sessionId}`)));
    };

    // Eight pending sessions fill the pending cap: a ninth OPEN is refused and allocates nothing.
    const first = await open(ids(1, 8));
    send(encodeOpen(9));
    expect(await fromHost.until("close 9")).toBe(4429);
    expect(sessions.seen.has("9")).toBe(false);

    // Answered, they are active; more sessions are admitted up to 31 active.
    await answer(first);
    for (const [from, count] of [
      [10, 8],
      [18, 8],
      [26, 7],
    ] as const)
      // oxlint-disable-next-line no-await-in-loop -- each batch must be answered before the next fits the pending cap
      await answer(await open(ids(from, count)));
    const [late] = await open([40]);
    if (late === undefined) throw new Error("session 40 was not opened");
    // 32 active: a pending session's first DATA is refused, whether it opened before or after the cap filled.
    await answer(await open([34]));
    const lateClosed = new Promise<Error | undefined>((resolve) => late.onClose(resolve));
    await expect(late.send(new Uint8Array([1]))).rejects.toBeInstanceOf(RelayCloseError);
    expect(await fromHost.until("close 40")).toBe(4429);
    expect((await lateClosed) instanceof RelayCloseError).toBe(true);
    expect(fromHost.seen.has("data 40")).toBe(false);
    const [after] = await open([41]);
    if (after === undefined) throw new Error("session 41 was not opened");
    await expect(after.send(new Uint8Array([1]))).rejects.toBeInstanceOf(RelayCloseError);
    expect(await fromHost.until("close 41")).toBe(4429);
    expect(fromHost.seen.has("data 41")).toBe(false);

    // The sessions already open keep working.
    const [one] = first;
    if (one === undefined) throw new Error("session 1 was not opened");
    const delivered = new Promise<Uint8Array>((resolve) => one.onData((bytes) => resolve(bytes)));
    send(encodeData(1, new Uint8Array([7])));
    expect(await delivered).toEqual(new Uint8Array([7]));
    await one.send(new Uint8Array([2]));

    // A session the client leaves frees its place.
    send(encodeClose(1, 1000));
    await answer(await open([42]));
    expect(refused).toEqual([
      { sessionId: 9, reason: "pending_cap" },
      { sessionId: 40, reason: "active_cap" },
      { sessionId: 41, reason: "active_cap" },
    ]);
  } finally {
    uplink.stop();
  }
}, 20_000);
