import { describe, expect, test } from "bun:test";
import { FrameKind } from "@doriface/protocol";
import { HcConnection, type SubscribeOptions } from "./connection.ts";
import { HcLinkSilentError } from "./errors.ts";
import { FakeCore } from "./testing/fake-core.ts";
import { HELLO_REPLY_LINE, SUBSCRIBE_REPLY, withId } from "./testing/fixtures.ts";

const CHANNEL = 1;
const next = <T>(register: (resolve: (value: T) => void) => void): Promise<T> =>
  new Promise((resolve) => register(resolve));

async function subscribed(options: SubscribeOptions) {
  const core = new FakeCore();
  const opening = HcConnection.open(core.client);
  await core.waitHello();
  core.push(`${HELLO_REPLY_LINE}\n`);
  const connection = await opening;
  const subscribing = connection.subscribe({}, options);
  const request = await core.waitRequest("events.subscribe");
  core.pushFrame(0, 0, withId(SUBSCRIBE_REPLY, Number(request.id)));
  return { core, connection, feed: await subscribing };
}

describe("a silent link", () => {
  test("closes the connection with HcLinkSilentError once the feed's heartbeats stop", async () => {
    const { connection } = await subscribed({ heartbeatTimeoutMs: 30 });
    const closed = next<Error | undefined>((resolve) => connection.onClose(resolve));
    const error = await closed;
    expect(error).toBeInstanceOf(HcLinkSilentError);
    expect(connection.closed).toBe(true);
  });

  test("leaves the connection open while heartbeats keep arriving", async () => {
    const { core, connection, feed } = await subscribed({ heartbeatTimeoutMs: 200 });
    for (let seq = 3; seq < 8; seq++) {
      core.pushFrame(CHANNEL, FrameKind.Data, `{"jsonrpc":"2.0","method":"heartbeat","params":{"seq":${seq}}}\n`);
      // oxlint-disable-next-line no-await-in-loop -- heartbeats must be spaced in time; time is the behavior under test
      await Bun.sleep(60);
    }
    expect(connection.closed).toBe(false);
    feed.close();
  });

  test("a feed closed by its owner does not close the connection", async () => {
    const { connection, feed } = await subscribed({ heartbeatTimeoutMs: 30 });
    feed.close();
    await Bun.sleep(80);
    expect(connection.closed).toBe(false);
    connection.close();
  });
});
