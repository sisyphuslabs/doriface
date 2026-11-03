import { describe, expect, test } from "bun:test";
import { Matches, watchScreen } from "./support/watch.ts";

/** A terminal stream whose output the test pushes by hand. */
function fakeStream(): {
  readonly onData: (listener: (bytes: Uint8Array) => void) => () => void;
  write: (text: string) => void;
} {
  const listeners = new Set<(bytes: Uint8Array) => void>();
  return {
    onData: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    write: (text) => {
      for (const listener of listeners) listener(new TextEncoder().encode(text));
    },
  };
}

describe("Matches", () => {
  test("a wait that times out is no longer registered, and a later match resolves only new waits", async () => {
    const items = new Matches<string>();
    const expired = await items
      .next((item) => item === "late", "a late item", 10)
      .then(
        () => "resolved",
        (error: unknown) => String(error),
      );
    expect(expired).toContain("a late item did not happen within 10 ms");
    expect(items.waiting).toBe(0);
    items.push("late");
    expect(await items.next((item) => item === "late", "the late item")).toBe("late");
  });
});

describe("watchScreen", () => {
  test("a line wait takes the caller's deadline, not the default step", async () => {
    const stream = fakeStream();
    const screen = watchScreen(stream);
    const expired = await screen.line("never", 25).then(
      () => "resolved",
      (error: unknown) => String(error),
    );
    expect(expired).toContain('the line "never" did not happen within 25 ms');
    const late = screen.line("late", 60_000);
    stream.write("late\n");
    expect(await late).toBe("late");
  });
});
