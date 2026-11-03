import { HcRpcError } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { startOn } from "./start-on.ts";

const refusing = (kind: string, message: string) => () =>
  Promise.reject(new HcRpcError({ code: -32000, message, data: { kind, hint: "" } }));

const run = (params: { readonly on: string }) => Promise.resolve({ address: `${params.on}/t4` });
const broken = () => Promise.reject(new Error("connection is closed"));

describe("startOn", () => {
  test("a started shell comes back with its machine-qualified address", async () => {
    expect(await startOn(run, "build-box")).toEqual({ ok: true, address: "build-box/t4" });
  });

  test.each([
    ["unavailable", "build-box is unreachable", "build-box is not connected"],
    ["machine_unknown", "unknown machine", "build-box is no longer added here"],
    ["needs_login", "needs a login", "build-box wants a login: run hc machine login build-box in a terminal"],
    ["needs_update", "too old", "build-box runs an hc too old for this: run hc machine update build-box"],
  ])("hc's %s refusal names the machine and what to do", async (kind, message, says) => {
    expect(await startOn(refusing(kind, message), "build-box")).toEqual({
      ok: false,
      failure: { machine: "build-box", kind, message: says },
    });
  });

  test("another refusal keeps hc's own message, and a broken connection is not swallowed", async () => {
    expect(await startOn(refusing("spawn_failed", "no shell"), "build-box")).toEqual({
      ok: false,
      failure: { machine: "build-box", kind: "spawn_failed", message: "no shell" },
    });
    await expect(startOn(broken, "build-box")).rejects.toThrow("connection is closed");
  });
});
