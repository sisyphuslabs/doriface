import { describe, expect, test } from "bun:test";
import { afterEnd, endSession, renameSession, type SessionCalls } from "./session-actions.ts";

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

  test("a screen that leaves when the program exits waits for End's terminal.rm", async () => {
    const asked = Promise.withResolvers<void>();
    const removed = Promise.withResolvers<unknown>();
    const connection: SessionCalls = {
      label: () => Promise.resolve({}),
      kill: () => Promise.resolve({ state: "finished" }),
      rm: () => {
        asked.resolve();
        return removed.promise;
      },
    };
    const left: string[] = [];
    const ending = endSession(connection, "t4");
    afterEnd("t4", () => left.push("t4"));
    afterEnd("t5", () => left.push("t5"));
    await asked.promise;
    // The program has exited and terminal.rm is out, unanswered: only the session with no End in flight has left.
    expect(left).toEqual(["t5"]);
    removed.resolve({});
    await ending;
    expect(left).toEqual(["t5", "t4"]);
  });

  test("a failed End lets the screen leave, and the next exit of that session leaves at once", async () => {
    const connection: SessionCalls = {
      label: () => Promise.resolve({}),
      kill: () => Promise.reject(new Error("no such terminal")),
      rm: () => Promise.resolve({}),
    };
    const left: string[] = [];
    const ending = endSession(connection, "t6");
    afterEnd("t6", () => left.push("after-failure"));
    await expect(ending).rejects.toThrow("no such terminal");
    afterEnd("t6", () => left.push("later"));
    expect(left).toEqual(["after-failure", "later"]);
  });
});
