import { HcConnection } from "@doriface/client";
import { isJsonObject, type JsonValue, MESH_OFFER_DOC } from "@doriface/protocol";
import { expect, test } from "bun:test";
import { spawnHcLink } from "./hc-machines.ts";
import { serveMeshOffers } from "./offer-doc.ts";
import { createHcSession } from "../testing/hc-session.ts";

type Session = ReturnType<typeof createHcSession>;

/** A client's line to the core: writes the request and waits for the document to reach a value it names. */
async function client(session: Session) {
  const link = spawnHcLink({ hc: session.hc, session: session.name, env: session.env });
  const core = await HcConnection.open(link);
  const feed = await core.subscribe();
  const waiters = new Set<() => Promise<void>>();
  feed.onEvent((event) => {
    if (event.type === "doc" && event.data.name === MESH_OFFER_DOC) for (const waiter of waiters) void waiter();
  });
  const read = async (): Promise<JsonValue> => (await core.call("doc.get", { name: MESH_OFFER_DOC })).value;
  return {
    async request(nonce: string): Promise<void> {
      const { version } = await core.call("doc.get", { name: MESH_OFFER_DOC });
      await core.call("doc.set", { name: MESH_OFFER_DOC, value: { request: nonce }, version });
    },
    /** Resolves with the document once `done` holds for it, checked now and on each doc event. */
    async until(done: (value: JsonValue) => boolean): Promise<JsonValue> {
      const now = await read();
      if (done(now)) return now;
      const { promise, resolve } = Promise.withResolvers<JsonValue>();
      const check = async (): Promise<void> => {
        const value = await read();
        if (!done(value)) return;
        waiters.delete(check);
        resolve(value);
      };
      waiters.add(check);
      return promise;
    },
    close(): void {
      core.close();
      link.close();
    },
  };
}

const field = (value: JsonValue, key: string): unknown => (isJsonObject(value) ? value[key] : undefined);

const noJoins = (): (() => void) => () => {};

test("a join on the offer is written back in place of the link, with the machine's name", async () => {
  const session = createHcSession("dh-offer-joined");
  const target = { hc: session.hc, session: session.name, env: session.env };
  const listeners = new Set<(join: { name: string; hostId: string }) => void>();
  const onAdmitted = (listener: (join: { name: string; hostId: string }) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const service = serveMeshOffers(
    target,
    () => {},
    onAdmitted,
    () => Promise.resolve({ link: "doriface://pair#h=x&m=1", expiresAt: Date.now() + 60_000 }),
  );
  const app = await client(session);
  try {
    await service.ready;
    await app.request("r1");
    await app.until((value) => field(value, "link") !== undefined);
    for (const listener of listeners) listener({ name: "laptop", hostId: "h2" });
    expect(await app.until((value) => field(value, "joined") !== undefined)).toEqual({
      request: "r1",
      joined: { name: "laptop", hostId: "h2" },
    });
  } finally {
    app.close();
    await service.stop();
    await session.dispose();
  }
}, 30_000);

test("a request is answered with one single-use offer, and the link is dropped once it expires", async () => {
  const session = createHcSession("dh-offer");
  const target = { hc: session.hc, session: session.name, env: session.env };
  let opened = 0;
  const service = serveMeshOffers(
    target,
    () => {},
    noJoins,
    () => {
      opened += 1;
      return Promise.resolve({ link: `doriface://pair#h=x&m=1&n=${opened}`, expiresAt: Date.now() + 1_500 });
    },
  );
  const app = await client(session);
  try {
    await service.ready;
    await app.request("first");
    const answered = await app.until((value) => typeof field(value, "link") === "string");
    expect(answered).toEqual({ request: "first", link: "doriface://pair#h=x&m=1&n=1", expiresAt: expect.any(Number) });
    // The host's own write is a doc event too; it must not open a second offer for the same request.
    const expired = await app.until((value) => field(value, "expired") === true);
    expect(expired).toEqual({ request: "first", expired: true });
    expect(opened).toBe(1);

    await app.request("second");
    const second = await app.until(
      (value) => field(value, "request") === "second" && field(value, "link") !== undefined,
    );
    expect(field(second, "link")).toBe("doriface://pair#h=x&m=1&n=2");
  } finally {
    app.close();
    await service.stop();
    await session.dispose();
  }
}, 30_000);

test("an offer the host cannot open is answered with why", async () => {
  const session = createHcSession("dh-offer-fail");
  const target = { hc: session.hc, session: session.name, env: session.env };
  const service = serveMeshOffers(
    target,
    () => {},
    noJoins,
    () => Promise.reject(new Error("the mesh is full")),
  );
  const app = await client(session);
  try {
    await service.ready;
    await app.request("n1");
    expect(await app.until((value) => field(value, "error") !== undefined)).toEqual({
      request: "n1",
      error: "the mesh is full",
    });
  } finally {
    app.close();
    await service.stop();
    await session.dispose();
  }
}, 30_000);
