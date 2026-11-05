import { describe, expect, test } from "bun:test";
import { type StartedPart, stopStarted } from "./stop-started.ts";

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

  test("a stop that does not settle within the bound is logged and left, and the rest still stop", async () => {
    const stopped: string[] = [];
    const logs: string[] = [];
    const parts: StartedPart[] = [
      { name: "push feed", stop: () => stopped.push("push feed") },
      { name: "relay uplink", stop: () => new Promise<void>(() => {}) },
    ];
    await stopStarted(parts, (line) => logs.push(line), 20);
    expect(stopped).toEqual(["push feed"]);
    expect(logs).toEqual(["startup: the relay uplink did not stop within 20 ms; leaving it"]);
  });
});
