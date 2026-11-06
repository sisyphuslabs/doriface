import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { describePortFailure, listPortHolders } from "./port-holders.ts";

test("a port holder is named by its pid and its command", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  try {
    const holders = listPortHolders([address.port]);
    expect(holders.length).toBeGreaterThan(0);
    const mine = holders.find((holder) => holder.port === address.port);
    expect(mine?.pid).toBe(process.pid);
    expect(mine?.command ?? "").toContain("bun");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15_000);

test("a port nobody holds has no holder", () => {
  expect(listPortHolders([1])).toEqual([]);
});

test("the failure names the bases it tried and who holds them", () => {
  const described = describePortFailure([51_234, 51_290], [{ port: 51_234, pid: 4_412, command: "bun" }]);
  expect(described).toContain("51234");
  expect(described).toContain("pid 4412");
  expect(described).toContain("bun");
});

test("the failure says so when no listener could be named", () => {
  expect(describePortFailure([], [])).toContain("no listener could be named");
});

test("a listener that could not be named still reports the bases tried", () => {
  expect(describePortFailure([40_001], [])).toContain("40001");
});
