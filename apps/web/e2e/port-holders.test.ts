import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { listPortHolders } from "./port-holders.ts";

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
