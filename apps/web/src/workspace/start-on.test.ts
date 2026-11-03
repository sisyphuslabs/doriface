import { HcRpcError } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { startOn, startTerminal } from "./start-on.ts";

const refusing = (kind: string, message: string) => () =>
  Promise.reject(new HcRpcError({ code: -32000, message, data: { kind, hint: "" } }));

const run = (params: { readonly on: string }) => Promise.resolve({ address: `${params.on}/t4` });
const broken = () => Promise.reject(new Error("connection is closed"));

describe("startOn", () => {
  test("a started shell comes back with its machine-qualified address", async () => {
    expect(await startOn(run, "build-box")).toEqual({ ok: true, address: "build-box/t4" });
  });

  test.each(["unavailable", "machine_unknown"])(
    "terminal.run's %s refusal comes back as that kind, with advice naming the machine",
    async (kind) => {
      const started = await startOn(refusing(kind, "raw"), "build-box");
      if (started.ok) throw new Error("expected a refusal");
      expect([started.failure.kind, started.failure.machine]).toEqual([kind, "build-box"]);
      expect(started.failure.message).toContain("build-box");
      expect(started.failure.message).not.toBe("raw");
    },
  );

  test("another refusal keeps hc's own message, and a broken connection is not swallowed", async () => {
    expect(await startOn(refusing("spawn_failed", "no shell"), "build-box")).toEqual({
      ok: false,
      failure: { machine: "build-box", kind: "spawn_failed", message: "no shell" },
    });
    await expect(startOn(broken, "build-box")).rejects.toThrow("connection is closed");
  });
});

describe("startTerminal", () => {
  test("a run on this machine that fails comes back as a failure naming it, never as a rejection", async () => {
    const started = await startTerminal(() => Promise.reject(new Error("connection is closed")), {}, "studio");
    expect(started).toEqual({
      ok: false,
      failure: { machine: "studio", kind: "connection", message: "connection is closed" },
    });
  });

  test("a run on an added machine keeps startOn's advice", async () => {
    const started = await startTerminal(refusing("unavailable", "raw"), { on: "build-box", cwd: "/w" }, "studio");
    if (started.ok) throw new Error("expected a refusal");
    expect(started.failure.message).toContain("build-box");
  });
});
