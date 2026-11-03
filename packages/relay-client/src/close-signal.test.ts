import { describe, expect, test } from "bun:test";
import { CloseSignal } from "./inbox.ts";

describe("close signal", () => {
  test("a throwing listener does not stop the others; its error is rethrown after all ran", () => {
    const signal = new CloseSignal();
    const failure = new Error("listener bug");
    const seen: string[] = [];
    signal.add(() => {
      seen.push("first");
      throw failure;
    });
    signal.add(() => seen.push("second"));
    expect(() => signal.fire(undefined)).toThrow(failure);
    expect(seen).toEqual(["first", "second"]);
  });

  test("a listener added after the close and removed before its turn never runs", async () => {
    const signal = new CloseSignal();
    signal.fire(undefined);
    const seen: string[] = [];
    const unsubscribe = signal.add(() => seen.push("late"));
    unsubscribe();
    signal.add(() => seen.push("kept"));
    await Promise.resolve();
    expect(seen).toEqual(["kept"]);
  });
});
