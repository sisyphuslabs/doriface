import { afterEach, describe, expect, test } from "bun:test";
import { defer, runDeferred } from "./support/cleanup.ts";
import { liveAmong, liveDescendants } from "./support/processes.ts";
import { BindRace, type LocalRelayOptions, startLocalRelay } from "./support/relay-dev.ts";

/** Linux's default ephemeral range starts here; macOS's starts higher. */
const EPHEMERAL_FLOOR = 32_768;

afterEach(runDeferred);

/** A port another process holds, as one that took a picked port before wrangler bound it would. */
function takenPort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  defer(() => listener.stop(true));
  return listener.port;
}

function counting(pick: (index: number, pickFree: () => number) => number): {
  readonly options: LocalRelayOptions;
  picks(): number;
} {
  let picks = 0;
  return { options: { pickPort: (pickFree) => pick(picks++, pickFree) }, picks: () => picks };
}

const failureOf = (start: Promise<unknown>): Promise<unknown> =>
  start.then(
    () => undefined,
    (error: unknown) => error,
  );

describe("startLocalRelay", () => {
  test("an HTTP port taken between the pick and wrangler's bind is retried on a freshly picked port", async () => {
    const taken = takenPort();
    const picker = counting((index, pickFree) => (index === 0 ? taken : pickFree()));
    const relay = await startLocalRelay({}, picker.options);
    defer(() => relay.stop());
    const port = Number(new URL(relay.url).port);
    expect(picker.picks()).toBe(2);
    expect(port).not.toBe(taken);
    expect(port).toBeLessThan(EPHEMERAL_FLOOR);
    expect((await fetch(`${relay.url}/healthz`)).status).toBe(200);
  }, 120_000);

  test("a start failure that is not a bind race on the picked port is not retried", async () => {
    const picker = counting(() => 70_000);
    const failure = await failureOf(startLocalRelay({}, picker.options));
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(BindRace);
    expect(picker.picks()).toBe(1);
  }, 120_000);

  test("a picked port taken on every attempt fails as a bind race on the third", async () => {
    const ports: number[] = [];
    const picker = counting(() => {
      const port = takenPort();
      ports.push(port);
      return port;
    });
    const failure = await failureOf(startLocalRelay({}, picker.options));
    expect(picker.picks()).toBe(3);
    expect(failure).toBeInstanceOf(BindRace);
    expect(failure instanceof BindRace ? failure.port : undefined).toBe(ports[2]);
  }, 120_000);

  test("stop() returns only once every process wrangler dev started has exited", async () => {
    const relay = await startLocalRelay();
    const started = await liveDescendants(process.pid);
    expect(started.length).toBeGreaterThanOrEqual(3);
    await relay.stop();
    expect(await liveAmong(started)).toEqual([]);
  }, 120_000);
});
