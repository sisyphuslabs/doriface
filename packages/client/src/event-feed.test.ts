import { describe, expect, test } from "bun:test";
import { FrameKind, readCredit, type HcEvent, type HcSnapshot, type JsonRpcNotification } from "@doriface/protocol";
import { HcConnection, type SubscribeOptions } from "./connection.ts";
import type { EventFeed, FeedClose } from "./event-feed.ts";
import { FakeCore } from "./testing/fake-core.ts";
import { bytes, FINISHED_EVENT, HELLO_REPLY_LINE, SIZE_EVENT, SUBSCRIBE_REPLY, withId } from "./testing/fixtures.ts";

const CHANNEL = 1;
const next = <T>(register: (resolve: (value: T) => void) => void): Promise<T> =>
  new Promise((resolve) => register(resolve));
const event = (seq: number, type: string, data: string) =>
  `{"jsonrpc":"2.0","method":"event","params":{"data":${data},"seq":${seq},"terminal":"t1","type":"${type}"}}\n`;

async function subscribed(options: SubscribeOptions = { heartbeatTimeoutMs: 0 }) {
  const core = new FakeCore();
  const opening = HcConnection.open(core.client);
  await core.waitHello();
  core.push(`${HELLO_REPLY_LINE}\n`);
  const subscribing = (await opening).subscribe({}, options);
  const request = await core.waitRequest("events.subscribe");
  core.pushFrame(0, 0, withId(SUBSCRIBE_REPLY, Number(request.id)));
  const feed: EventFeed = await subscribing;
  return { core, feed };
}

function collect(feed: EventFeed, count: number): Promise<HcEvent[]> {
  const events: HcEvent[] = [];
  return next((resolve) =>
    feed.onEvent((received) => {
      events.push(received);
      if (events.length === count) resolve(events);
    }),
  );
}

describe("EventFeed", () => {
  test("starts from the snapshot and delivers events split across frames, crediting each frame", async () => {
    const { core, feed } = await subscribed();
    expect([feed.channel, feed.snapshot.seq, feed.snapshot.terminals.map((t) => t.address)]).toEqual([
      CHANNEL,
      2,
      ["t1"],
    ]);
    const events = collect(feed, 2);
    const stream = bytes(SIZE_EVENT + FINISHED_EVENT);
    core.pushFrame(CHANNEL, FrameKind.Data, stream.subarray(0, 50));
    core.pushFrame(CHANNEL, FrameKind.Data, stream.subarray(50));
    const received = await events;
    expect(received.map((e) => [e.seq, e.type])).toEqual([
      [3, "size"],
      [5, "finished"],
    ]);
    const creditOf = (amount: number) =>
      core.waitFrame((f) => f.channel === CHANNEL && f.kind === FrameKind.Credit && readCredit(f.payload) === amount);
    await Promise.all([creditOf(50), creditOf(stream.byteLength - 50)]);
    expect(feed.seq).toBe(5);
  });

  test("drops events at or below the snapshot seq and restarts from a missed snapshot", async () => {
    const { core, feed } = await subscribed();
    const snapshots: HcSnapshot[] = [];
    feed.onSnapshot((snapshot) => snapshots.push(snapshot));
    const events = collect(feed, 2);
    core.pushFrame(
      CHANNEL,
      FrameKind.Data,
      event(2, "title", '{"title":"stale"}') +
        event(3, "title", '{"title":"fresh"}') +
        '{"jsonrpc":"2.0","method":"missed","params":{"seq":10,"terminals":[]}}\n' +
        event(9, "title", '{"title":"before snapshot"}') +
        event(11, "title", '{"title":"after snapshot"}'),
    );
    const received = await events;
    expect(received.map((e) => (e.type === "title" ? e.data.title : e.type))).toEqual(["fresh", "after snapshot"]);
    expect(snapshots).toEqual([{ seq: 10, terminals: [] }]);
    expect(feed.snapshot).toEqual({ seq: 10, terminals: [] });
  });

  test("passes notifications from a newer core to onUnknown", async () => {
    const { core, feed } = await subscribed();
    const unknown = next<JsonRpcNotification>((resolve) => feed.onUnknown(resolve));
    feed.onEvent(() => {});
    core.pushFrame(CHANNEL, FrameKind.Data, '{"jsonrpc":"2.0","method":"rewound","params":{"seq":4}}\n');
    expect((await unknown).method).toBe("rewound");
  });

  test("closes after heartbeat silence and tells the core", async () => {
    const { core, feed } = await subscribed({ heartbeatTimeoutMs: 30 });
    const closed = next<FeedClose>((resolve) => feed.onClose(resolve));
    expect(await closed).toEqual({ reason: "heartbeat_timeout" });
    const close = await core.waitFrame((f) => f.channel === CHANNEL && f.kind === FrameKind.Close);
    expect(close.payload.byteLength).toBe(0);
  });

  test("ends on a malformed line, a core CLOSE, a local close and a dropped link", async () => {
    const malformed = await subscribed();
    const protocol = next<FeedClose>((resolve) => malformed.feed.onClose(resolve));
    malformed.core.pushFrame(CHANNEL, FrameKind.Data, '{"jsonrpc":"2.0","id":1,"result":{}}\n');
    expect((await protocol).reason).toBe("protocol_error");

    const byCore = await subscribed();
    const coreClosed = next<FeedClose>((resolve) => byCore.feed.onClose(resolve));
    byCore.core.pushFrame(CHANNEL, FrameKind.Close);
    expect(await coreClosed).toEqual({ reason: "closed_by_core" });

    const local = await subscribed();
    local.feed.close();
    expect(local.feed.closed).toBe(true);
    await local.core.waitFrame((f) => f.channel === CHANNEL && f.kind === FrameKind.Close);

    const dropped = await subscribed();
    const linkGone = next<FeedClose>((resolve) => dropped.feed.onClose(resolve));
    dropped.core.hangUp();
    expect((await linkGone).reason).toBe("connection_closed");
  });
});
