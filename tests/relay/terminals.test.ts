import { describe, expect, test } from "bun:test";
import { type HcRun, killAndRemove } from "./support/terminals.ts";

/**
 * hc as it answers kill, wait and rm: `kill` reports `observed` ("live" while the program is still being torn down),
 * `wait` returns once the program has ended, and `rm` refuses a terminal that is still running, with hc's own error.
 */
function fakeHc(observed: "live" | "finished"): { readonly hc: HcRun; readonly calls: string[] } {
  const calls: string[] = [];
  let ended = observed === "finished";
  const hc: HcRun = (args) => {
    calls.push(args[0] ?? "");
    if (args[0] === "kill") return JSON.stringify({ address: "t1", state: observed });
    if (args[0] === "wait") {
      ended = true;
      return JSON.stringify({ address: "t1", state: "finished" });
    }
    if (args[0] === "rm" && !ended) {
      throw new Error(
        'hc rm t1: {"error":{"hint":"kill it first: hc kill t1","kind":"live","message":"t1 is still running"}}',
      );
    }
    return JSON.stringify({ removed: "t1" });
  };
  return { hc, calls };
}

describe("killAndRemove (#469)", () => {
  test("a kill that observed the program still live is waited out before the remove", () => {
    const { hc, calls } = fakeHc("live");
    killAndRemove(hc, "t1");
    expect(calls).toEqual(["kill", "wait", "rm"]);
  });

  test("a kill that observed the end removes at once", () => {
    const { hc, calls } = fakeHc("finished");
    killAndRemove(hc, "t1");
    expect(calls).toEqual(["kill", "rm"]);
  });
});
