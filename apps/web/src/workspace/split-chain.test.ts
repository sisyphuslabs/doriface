import { describe, expect, test } from "bun:test";
import { SplitChain } from "./split-chain.ts";

const placed = (chain: SplitChain, tab: string, focused: string, source: string | null = null) => {
  const link = chain.next(tab, focused, source);
  const { promise, resolve } = Promise.withResolvers<string>();
  return { link, from: promise, land: () => link.place(resolve) };
};

describe("splits pressed back to back", () => {
  test("the second comes off the pane the first makes, whichever terminal starts first", async () => {
    const chain = new SplitChain();
    const first = placed(chain, "tab", "five");
    const second = placed(chain, "tab", "five");
    second.land();
    first.land();
    expect(await first.from).toBe("five");
    expect(await second.from).toBe(first.link.pane);
  });

  test("a split whose terminal did not start hands its own source to the next", async () => {
    const chain = new SplitChain();
    const first = chain.next("tab", "five", null);
    const second = placed(chain, "tab", "five");
    second.land();
    first.fail();
    expect(await second.from).toBe("five");
  });

  test("a split that names its pane comes off it, still after the one before", async () => {
    const chain = new SplitChain();
    const order: string[] = [];
    const first = chain.next("tab", "five", null);
    const named = chain.next("tab", "five", "two");
    const done = Promise.withResolvers<void>();
    named.place((from) => {
      order.push(`named:${from}`);
      done.resolve();
    });
    first.place((from) => order.push(`first:${from}`));
    await done.promise;
    expect(order).toEqual(["first:five", "named:two"]);
  });

  test("tabs do not wait on each other, and a settled chain starts again from the focused pane", async () => {
    const chain = new SplitChain();
    const other = placed(chain, "other", "x");
    other.land();
    expect(await other.from).toBe("x");
    const again = placed(chain, "other", "y");
    again.land();
    expect(await again.from).toBe("y");
  });
});
