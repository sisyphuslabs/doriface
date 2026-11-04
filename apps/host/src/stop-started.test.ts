import { describe, expect, test } from "bun:test";
import { type StartedPart, stopStarted } from "./stop-started.ts";

/** One turn of the event loop, after every microtask queued so far has run. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("stopStarted", () => {
  test("stops the parts latest first, and a stop that throws is logged while the rest still stop", async () => {
    const stopped: string[] = [];
    const logs: string[] = [];
    const part = (name: string, stop: () => unknown = () => stopped.push(name)): StartedPart => ({ name, stop });
    const parts = [
      part("mesh sync"),
      part("push feed", () => {
        stopped.push("push feed");
        throw new Error("no feed");
      }),
      part("gateway", async () => {
        stopped.push("gateway");
        throw new Error("no gateway");
      }),
      part("main listener"),
    ];
    await stopStarted(parts, (line) => logs.push(line));
    expect(stopped).toEqual(["main listener", "gateway", "push feed", "mesh sync"]);
    expect(logs).toEqual([
      "startup: stopping the gateway failed: Error: no gateway",
      "startup: stopping the push feed failed: Error: no feed",
    ]);
  });

  test("one deadline for the whole unwind: a part still stopping then is killed, or left, and the rest still stop", async () => {
    const stopped: string[] = [];
    const logs: string[] = [];
    const feed = Promise.withResolvers<void>();
    let feedDone = false;
    let feedSettledFirst = false;
    const parts: StartedPart[] = [
      { name: "mesh sync", stop: () => (feedSettledFirst = feedDone) },
      // Killing its child is what lets the feed's stop settle, a turn later as a killed process exits; the unwind
      // waits for that before it stops the next part.
      {
        name: "push feed",
        stop: () => feed.promise.then(() => void (feedDone = true)),
        kill: () => {
          setImmediate(() => feed.resolve());
          return ["hc connect pid 4242"];
        },
      },
      { name: "relay uplink", stop: () => new Promise<void>(() => {}) },
      { name: "main listener", stop: () => stopped.push("main listener") },
    ];
    // The deadline has already passed: each part's stop is still called, and only one that settles at once is not
    // reported.
    await stopStarted(parts, (line) => logs.push(line), { expired: Promise.resolve() });
    expect(stopped).toEqual(["main listener"]);
    expect(logs).toEqual([
      "startup: the relay uplink did not stop by the 5000 ms deadline; leaving it",
      "startup: the push feed did not stop by the 5000 ms deadline; killed hc connect pid 4242",
    ]);
    expect(feedSettledFirst).toBe(true);
  });

  test("a stop that rejects after the deadline is logged, not left unhandled", async () => {
    const logs: string[] = [];
    const late = Promise.withResolvers<void>();
    await stopStarted([{ name: "gateway", stop: () => late.promise }], (line) => logs.push(line), {
      expired: Promise.resolve(),
    });
    late.reject(new Error("closed too late"));
    await turn();
    expect(logs).toEqual([
      "startup: the gateway did not stop by the 5000 ms deadline; leaving it",
      "startup: the gateway failed after the deadline: Error: closed too late",
    ]);
  });
});
