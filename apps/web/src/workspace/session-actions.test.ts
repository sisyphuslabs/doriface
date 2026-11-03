import { describe, expect, test } from "bun:test";
import { endSession, renameSession, type SessionCalls } from "./session-actions.ts";

type Call = { readonly method: string; readonly params: unknown };

/** The calls a session action makes, recorded; terminal.kill answers with a finished terminal. */
function recorder() {
  const calls: Call[] = [];
  const record =
    (method: string) =>
    (params: unknown): Promise<{ readonly state: "finished" }> => {
      calls.push({ method, params });
      return Promise.resolve({ state: "finished" });
    };
  const connection: SessionCalls = {
    label: record("terminal.label"),
    kill: record("terminal.kill"),
    rm: record("terminal.rm"),
  };
  return { calls, connection };
}

describe("session actions", () => {
  test("a rename is the herdr.name label, and an empty name removes it (herdr-app label rules)", async () => {
    const { calls, connection } = recorder();
    await renameSession(connection, "t3", "  deploy  ");
    await renameSession(connection, "t3", "");
    expect(calls).toEqual([
      { method: "terminal.label", params: { terminal: "t3", labels: { "herdr.name": "deploy" } } },
      { method: "terminal.label", params: { terminal: "t3", labels: { "herdr.name": "" } } },
    ]);
  });

  test("ending kills the program, then removes the finished terminal", async () => {
    const { calls, connection } = recorder();
    await endSession(connection, "box/t2");
    expect(calls.map((call) => call.method)).toEqual(["terminal.kill", "terminal.rm"]);
  });
});
