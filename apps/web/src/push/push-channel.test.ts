import { expect, test } from "bun:test";
import type { PushClientLine, PushHostLine } from "@doriface/protocol";
import { PushChannel } from "./push-channel.ts";
import type { PushRoute } from "./push-route.ts";
import type { PushStreamClient } from "./push-stream-client.ts";

const ROUTE: PushRoute = { mode: "loopback", pushUrl: "ws://127.0.0.1:1/v1/push", token: "t0k" };
const LINE: PushClientLine = { t: "unsubscribe", endpoint: "https://push.example/e1" };
const REPLY: PushHostLine = { t: "ok" };

class Stream {
  readonly sent: PushClientLine[] = [];
  readonly asked = Promise.withResolvers<PushClientLine>();
  readonly answered = Promise.withResolvers<PushHostLine>();
  closed = false;

  async request(line: PushClientLine): Promise<PushHostLine> {
    this.sent.push(line);
    this.asked.resolve(line);
    return this.answered.promise;
  }

  tell(line: PushClientLine): void {
    this.sent.push(line);
  }

  close(): void {
    this.closed = true;
  }
}

function channel(): {
  readonly channel: PushChannel;
  readonly slots: PromiseWithResolvers<Stream>[];
  readonly dialling: PromiseWithResolvers<void>;
} {
  const slots: PromiseWithResolvers<Stream>[] = [];
  const dialling = Promise.withResolvers<void>();
  const made = new PushChannel(async () => {
    const slot: PromiseWithResolvers<Stream> = Promise.withResolvers();
    slots.push(slot);
    await dialling.promise;
    const stream = new Stream();
    slot.resolve(stream);
    return stream as unknown as PushStreamClient;
  });
  return { channel: made, slots, dialling };
}

test("a request runs on a stream of its own, and a reset while it opens does not cancel it (#446 §2, §3)", async () => {
  const { channel: made, slots, dialling } = channel();
  const answer = made.requestOnce(LINE, ROUTE);
  made.reset();
  dialling.resolve();
  const stream = await slots[0]?.promise;
  if (stream === undefined) throw new Error("the request opened no stream");
  expect(await stream.asked.promise).toEqual(LINE);

  stream.answered.resolve(REPLY);
  expect(await answer).toEqual(REPLY);
  expect(stream.sent).toEqual([LINE]);
  expect(stream.closed).toBe(true);
});

test("every request gets its own stream, and finishing one leaves the others alone", async () => {
  const { channel: made, slots, dialling } = channel();
  dialling.resolve();
  const first = made.requestOnce(LINE, ROUTE);
  const second = made.requestOnce({ t: "hello" }, ROUTE);
  const streams = await Promise.all(slots.map((slot) => slot.promise));
  expect(streams).toHaveLength(2);
  const [one, two] = streams;
  if (one === undefined || two === undefined) throw new Error("a request opened no stream");
  await Promise.all([one.asked.promise, two.asked.promise]);

  one.answered.resolve(REPLY);
  two.answered.resolve({ t: "ready", vapidKey: "a2V5", subscriptions: [] });
  expect(await first).toEqual(REPLY);
  expect(await second).toEqual({ t: "ready", vapidKey: "a2V5", subscriptions: [] });
  expect(one.sent).toEqual([LINE]);
  expect(two.sent).toEqual([{ t: "hello" }]);
  expect(one.closed).toBe(true);
  expect(two.closed).toBe(true);
});
