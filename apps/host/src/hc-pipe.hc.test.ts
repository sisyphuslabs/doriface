import { afterAll, beforeAll, expect, test } from "bun:test";
import { DRAIN_GRACE_MS, HcPipe } from "./hc-pipe.ts";
import { createHcSession, type HcSession } from "./testing/hc-session.ts";

let hc: HcSession;
beforeAll(() => {
  hc = createHcSession("hc-pipe");
});
afterAll(async () => {
  await hc.dispose();
});

const encoder = new TextEncoder();
const hcJson = (...args: string[]): Record<string, unknown> =>
  JSON.parse(Bun.spawnSync([hc.hc, ...args, "--json"], { env: hc.env }).stdout.toString());
const line = (id: number, method: string, params: object): string =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;

/** Starts a terminal, sends End's mark and kill for it down a fresh pipe, closes the pipe at once; returns its address. */
async function endThenClose(): Promise<string> {
  const address = String(hcJson("run", "--bg", "--", "sleep", "300")["address"]);
  const pipe = new HcPipe({ hc: hc.hc, session: hc.name, env: hc.env, log: () => {} });
  pipe.onData(() => {});
  await pipe.send(
    encoder.encode(
      line(0, "hello", {}) +
        line(1, "terminal.label", { terminal: address, labels: { "herdr.end": "1" } }) +
        line(2, "terminal.kill", { terminal: address }),
    ),
  );
  // The page's socket closes now: the bridge closes this pipe before the child has handed the core either request.
  pipe.close();
  const started = performance.now();
  await pipe.exited;
  // It exited on its own once it had passed them on, well before the grace that would kill it.
  expect(performance.now() - started).toBeLessThan(DRAIN_GRACE_MS);
  return address;
}

test("requests sent just before a pipe closes still reach the core, as a closed page's End does (#580)", async () => {
  const addresses = await Promise.all(Array.from({ length: 10 }, endThenClose));
  for (const address of addresses) {
    const shown = hcJson("get", address);
    expect({ address, state: shown["state"], labels: shown["labels"] }).toEqual({
      address,
      state: "finished",
      labels: { "herdr.end": "1" },
    });
  }
});
