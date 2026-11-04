import { describe, expect, test } from "bun:test";
import { HcConnection, type SubscribeOptions } from "./connection.ts";
import { HcLinkSilentError } from "./errors.ts";
import { FakeCore } from "./testing/fake-core.ts";
import { HELLO_REPLY_LINE, SUBSCRIBE_REPLY, withId } from "./testing/fixtures.ts";

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

  test("a feed closed by its owner does not close the connection", async () => {
    const { connection, feed } = await subscribed({ heartbeatTimeoutMs: 30 });
    // The close it would cause happens inside feed.close(), and closing the feed stops its heartbeat timer.
    feed.close();
    expect(connection.closed).toBe(false);
    connection.close();
  });
});
