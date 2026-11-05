import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { withOwned } from "./owned.ts";

/** A stop that records each call and resolves when told, plus an exit that resolves `exited`. */
function rig() {
  const events: string[] = [];
  const stopped = Promise.withResolvers<void>();
  const exited = Promise.withResolvers<number>();
  const signals = new EventEmitter();
  return {
    events,
    signals,
    exited: exited.promise,
    finishStop: () => stopped.resolve(),
    stop: async (): Promise<void> => {
      events.push("stop");
      await stopped.promise;
      events.push("stopped");
    },
    exit: (code: number): void => {
      events.push(`exit ${code}`);
      exited.resolve(code);
    },
  };
}

describe("withOwned", () => {
  test("a body that returns: stop runs once, after it, and the listeners are gone", async () => {
    const r = rig();
    r.finishStop();
    const result = await withOwned(
      r.stop,
      async () => {
        r.events.push("body");
        return 42;
      },
      r,
    );
    expect(result).toBe(42);
    expect(r.events).toEqual(["body", "stop", "stopped"]);
    expect(r.signals.listenerCount("SIGINT") + r.signals.listenerCount("SIGTERM")).toBe(0);
  });

  test("a body that throws: stop runs once and the error comes back", async () => {
    const r = rig();
    r.finishStop();
    const failing = withOwned(
      r.stop,
      async () => {
        throw new Error("call failed");
      },
      r,
    );
    await expect(failing).rejects.toThrow("call failed");
    expect(r.events).toEqual(["stop", "stopped"]);
  });

  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("%s mid-run: stop runs, and only then the process exits %d", async (signal, code) => {
    const r = rig();
    const body = Promise.withResolvers<void>();
    const run = withOwned(r.stop, () => body.promise, r);
    r.signals.emit(signal);
    expect(r.events).toEqual(["stop"]);
    r.finishStop();
    expect(await r.exited).toBe(code);
    expect(r.events).toEqual(["stop", "stopped", `exit ${code}`]);
    // The body then ends (the core it used is gone); stop is not run a second time.
    body.reject(new Error("link closed"));
    await expect(run).rejects.toThrow("link closed");
    expect(r.events.filter((event) => event === "stop")).toHaveLength(1);
  });

  test("a stop that fails on a signal exits 1, not 130", async () => {
    const r = rig();
    const body = Promise.withResolvers<void>();
    const run = withOwned(
      async () => {
        throw new Error("hc server stop exited 1");
      },
      () => body.promise,
      r,
    );
    r.signals.emit("SIGINT");
    expect(await r.exited).toBe(1);
    body.resolve();
    await expect(run).rejects.toThrow("hc server stop exited 1");
  });
});
