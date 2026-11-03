import { afterEach, describe, expect, test } from "bun:test";
import { defer, runDeferred } from "./support/cleanup.ts";
import { type LocalRelayOptions, startLocalRelay } from "./support/relay-dev.ts";

afterEach(runDeferred);

/** A port another process holds, as one that took a picked port before wrangler bound it would. */
function takenPort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  defer(() => listener.stop(true));
  return listener.port;
}

function releasedPort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

function counting(pick: (index: number) => number): { readonly options: LocalRelayOptions; picks(): number } {
  let picks = 0;
  return { options: { pickPort: () => pick(picks++) }, picks: () => picks };
}

const failureOf = (start: Promise<unknown>): Promise<string> =>
  start.then(
    () => "started",
    (error: unknown) => String(error),
  );

describe("startLocalRelay", () => {
  test("an HTTP port taken between the pick and wrangler's bind is retried on a freshly picked port", async () => {
    const taken = takenPort();
    const fresh = releasedPort();
    const picker = counting((index) => (index === 0 ? taken : fresh));
    const relay = await startLocalRelay({}, picker.options);
    defer(() => relay.stop());
    expect(picker.picks()).toBe(2);
    expect(relay.url).toBe(`http://127.0.0.1:${fresh}`);
    expect(relay.output()).toContain(`127.0.0.1:${taken} was taken before wrangler dev bound it`);
    expect((await fetch(`${relay.url}/healthz`)).status).toBe(200);
  }, 120_000);

  test("a start failure that is not a bind race on the picked port is not retried", async () => {
    const picker = counting(() => 70_000);
    expect(await failureOf(startLocalRelay({}, picker.options))).toContain("wrangler dev exited 1 before ready");
    expect(picker.picks()).toBe(1);
  }, 120_000);

  test("a picked port taken on every attempt fails after the third, with each race in the error", async () => {
    const picker = counting(() => takenPort());
    const failure = await failureOf(startLocalRelay({}, picker.options));
    expect(picker.picks()).toBe(3);
    expect(failure).toContain("was taken between picking it and wrangler dev binding it");
    expect(failure.match(/was taken before wrangler dev bound it; retrying on a fresh port/g)).toHaveLength(2);
  }, 120_000);
});
