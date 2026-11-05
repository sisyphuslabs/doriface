import { describe, expect, test } from "bun:test";
import { chainedSplit, SplitChain } from "./split-chain.ts";

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

describe("a split that landed before the screen shows its pane focused (#326)", () => {
  test("a key read in that gap, which still sees the old pane focused, splits the pane the landed split made", async () => {
    const chain = new SplitChain();
    const first = placed(chain, "tab", "two");
    first.land();
    expect(await first.from).toBe("two");
    const second = placed(chain, "tab", "two");
    second.land();
    expect(await second.from).toBe(first.link.pane);
  });

  test("once the screen shows the new pane focused, a pane focused after it is the one a key splits", async () => {
    const chain = new SplitChain();
    const first = placed(chain, "tab", "two");
    first.land();
    await first.from;
    chain.shown("tab", first.link.pane);
    chain.shown("tab", "two");
    const again = placed(chain, "tab", "two");
    again.land();
    expect(await again.from).toBe("two");
  });

  test("focus shown anywhere else ends the handoff too", async () => {
    const chain = new SplitChain();
    const first = placed(chain, "tab", "two");
    first.land();
    await first.from;
    chain.shown("tab", "three");
    const next = placed(chain, "tab", "two");
    next.land();
    expect(await next.from).toBe("two");
  });
});

describe("the workspace's split, through the chain", () => {
  test("two keys back to back: the second terminal starting first still splits the pane the first one makes", async () => {
    const chain = new SplitChain();
    const starts: { place: (address: string) => void }[] = [];
    const splits: [string, string, string][] = [];
    const { promise: bothLanded, resolve } = Promise.withResolvers<void>();
    const press = () =>
      chainedSplit(
        chain,
        { tab: "tab", focused: "two", source: null },
        (place) => starts.push({ place }),
        (address, from, made) => {
          splits.push([address, from, made]);
          if (splits.length === 2) resolve();
        },
      );
    press();
    press();
    starts[1]?.place("t-down");
    starts[0]?.place("t-right");
    await bothLanded;
    const [first, second] = splits;
    if (first === undefined || second === undefined) throw new Error("two splits were expected");
    expect([first[0], first[1]]).toEqual(["t-right", "two"]);
    expect([second[0], second[1]]).toEqual(["t-down", first[2]]);
    expect(second[2]).not.toBe(first[2]);
  });
});
