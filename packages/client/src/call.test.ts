import { describe, expect, test } from "bun:test";
import { HcRpcError } from "@doriface/protocol";
import { HcConnection } from "./connection.ts";
import type { ByteLink } from "./link.ts";
import { HcConnectionClosedError, HcProtocolError, HcTimeoutError } from "./errors.ts";
import { FakeCore } from "./testing/fake-core.ts";
import {
  bytes,
  concatBytes,
  frame,
  HELLO_REPLY_LINE,
  LIST_EMPTY_REPLY,
  RUN_REPLY,
  STATUS_REPLY,
  withId,
} from "./testing/fixtures.ts";

async function opened(core: FakeCore, callTimeoutMs?: number): Promise<HcConnection> {
  const connection = HcConnection.open(core.client, callTimeoutMs === undefined ? {} : { callTimeoutMs });
  await core.waitHello();
  core.push(`${HELLO_REPLY_LINE}\n`);
  return connection;
}

const decode = (payload: Uint8Array) => new TextDecoder().decode(payload);

/** Forwards to a real link until `refuseAfter` more writes, then throws like a dead socket. */
class RefusingLink implements ByteLink {
  refuseAfter = Number.POSITIVE_INFINITY;
  readonly #inner: ByteLink;

  constructor(inner: ByteLink) {
    this.#inner = inner;
  }

  send(chunk: Uint8Array): void {
    if (this.refuseAfter <= 0) throw new Error("socket write failed");
    this.refuseAfter -= 1;
    this.#inner.send(chunk);
  }

  onData(listener: (chunk: Uint8Array) => void) {
    return this.#inner.onData(listener);
  }

  onClose(listener: (error: Error | undefined) => void) {
    return this.#inner.onClose(listener);
  }

  close(): void {
    this.#inner.close();
  }
}

async function openedOver(core: FakeCore, link: ByteLink, callTimeoutMs?: number): Promise<HcConnection> {
  const connection = HcConnection.open(link, callTimeoutMs === undefined ? {} : { callTimeoutMs });
  await core.waitHello();
  core.push(`${HELLO_REPLY_LINE}\n`);
  return connection;
}

describe("HcConnection.call", () => {
  test("resolves the first reply at every chunk boundary after the hello", async () => {
    const stream = concatBytes(bytes(`${HELLO_REPLY_LINE}\n`), frame(0, 0, withId(STATUS_REPLY, 1)));
    const last = stream.byteLength - 1;
    const callAt = async (split: number) => {
      const core = new FakeCore();
      const opening = HcConnection.open(core.client);
      await core.waitHello();
      core.push(stream.subarray(0, split));
      core.push(stream.subarray(split, last));
      const status = (await opening).call("server.status");
      await core.waitRequest("server.status");
      core.push(stream.subarray(last));
      expect((await status).version).toBe("0.1.17");
    };
    await Promise.all(Array.from({ length: last - 1 }, (_, index) => callAt(index + 1)));
  });

  test("matches replies that arrive out of order to their calls", async () => {
    const core = new FakeCore();
    const connection = await opened(core);
    const list = connection.call("terminal.list", { all: true });
    const run = connection.call("terminal.run", { argv: ["/bin/sh"] });
    const [listRequest, runRequest] = await Promise.all([
      core.waitRequest("terminal.list"),
      core.waitRequest("terminal.run"),
    ]);
    expect(listRequest.id).not.toBe(runRequest.id);
    expect(listRequest.params).toEqual({ all: true });
    core.pushFrame(0, 0, withId(RUN_REPLY, Number(runRequest.id)));
    core.pushFrame(0, 0, withId(LIST_EMPTY_REPLY, Number(listRequest.id)));
    expect((await run).address).toBe("t1");
    expect((await list).terminals).toEqual([]);
  });

  test("rejects an error reply with HcRpcError", async () => {
    const core = new FakeCore();
    const connection = await opened(core);
    const kill = connection.call("terminal.kill", { terminal: "t9" });
    const request = await core.waitRequest("terminal.kill");
    core.pushFrame(
      0,
      0,
      `{"id":${request.id},"jsonrpc":"2.0","error":{"code":-32000,"message":"no terminal t9","data":{"kind":"not_found"}}}`,
    );
    const error: unknown = await kill.catch((caught: unknown) => caught);
    if (!(error instanceof HcRpcError)) throw new Error(`expected HcRpcError, got ${String(error)}`);
    expect([error.code, error.kind, error.message]).toEqual([-32000, "not_found", "no terminal t9"]);
  });

  test("times out, cancels the call on the core and ignores the late reply", async () => {
    const core = new FakeCore();
    const connection = await opened(core, 20);
    const status = connection.call("server.status");
    await expect(status).rejects.toThrow(HcTimeoutError);
    const request = await core.waitRequest("server.status");
    const notice = await core.waitFrame((f) => decode(f.payload).includes("$/cancelRequest"));
    expect(JSON.parse(decode(notice.payload))).toEqual({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: request.id },
    });
    core.pushFrame(0, 0, withId(STATUS_REPLY, Number(request.id)));
    const list = connection.call("terminal.list");
    const listRequest = await core.waitRequest("terminal.list");
    core.pushFrame(0, 0, withId(LIST_EMPTY_REPLY, Number(listRequest.id)));
    expect((await list).hidden_finished).toBe(0);
    expect(connection.closed).toBe(false);
  });

  test("rejects with the abort reason, and does not send when already aborted", async () => {
    const core = new FakeCore();
    const connection = await opened(core);
    const controller = new AbortController();
    const wait = connection.call("terminal.wait", { terminal: "t1" }, { signal: controller.signal });
    await core.waitRequest("terminal.wait");
    controller.abort(new Error("user left"));
    await expect(wait).rejects.toThrow("user left");
    await expect(connection.call("server.status", {}, { signal: controller.signal })).rejects.toThrow("user left");
    expect(core.requests().some((request) => request.method === "server.status")).toBe(false);
  });

  test("fails every pending call when the link drops", async () => {
    const core = new FakeCore();
    const connection = await opened(core);
    const calls = [connection.call("server.status"), connection.call("terminal.list")];
    await core.waitRequest("terminal.list");
    core.hangUp();
    const settled = await Promise.allSettled(calls);
    expect(settled.map((s) => s.status === "rejected" && s.reason instanceof HcConnectionClosedError)).toEqual([
      true,
      true,
    ]);
    await expect(connection.call("server.status")).rejects.toThrow(HcConnectionClosedError);
  });

  test("a link that refuses the hello rejects open with the link's error", async () => {
    const link = new RefusingLink(new FakeCore().client);
    link.refuseAfter = 0;
    await expect(HcConnection.open(link)).rejects.toThrow("socket write failed");
  });

  test("a refused write rejects the call and closes the connection", async () => {
    const core = new FakeCore();
    const link = new RefusingLink(core.client);
    const connection = await openedOver(core, link);
    link.refuseAfter = 0;
    const status = connection.call("server.status");
    await expect(status).rejects.toThrow("socket write failed");
    expect(connection.closed).toBe(true);
  });

  test("a timed-out call still rejects with HcTimeoutError when its cancel cannot be sent", async () => {
    const core = new FakeCore();
    const link = new RefusingLink(core.client);
    const connection = await openedOver(core, link, 20);
    link.refuseAfter = 1;
    await expect(connection.call("server.status")).rejects.toThrow(HcTimeoutError);
    expect(connection.closed).toBe(true);
  });

  test("rejects a malformed attach reply and closes the channel it named", async () => {
    const core = new FakeCore();
    const connection = await opened(core);
    const attach = connection.attach({ terminal: "t1", cols: 80, rows: 24 });
    const request = await core.waitRequest("terminal.attach");
    core.pushFrame(0, 0, `{"id":${request.id},"jsonrpc":"2.0","result":{"channel":3}}`);
    await expect(attach).rejects.toThrow(HcProtocolError);
    expect((await core.waitFrame((f) => f.channel === 3)).kind).toBe(2);
  });

  test("closes a stream whose attach reply came after the call gave up", async () => {
    const core = new FakeCore();
    const connection = await opened(core, 20);
    const attach = connection.call("terminal.attach", { terminal: "t1", cols: 80, rows: 24 });
    await expect(attach).rejects.toThrow(HcTimeoutError);
    const request = await core.waitRequest("terminal.attach");
    core.pushFrame(0, 0, `{"id":${request.id},"jsonrpc":"2.0","result":{"channel":5}}`);
    const close = await core.waitFrame((f) => f.channel === 5);
    expect([close.kind, close.payload.byteLength]).toEqual([2, 0]);
  });
});
