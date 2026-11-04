import { afterAll, expect, test } from "bun:test";
import { HcConnection } from "@doriface/client";
import { END_LABEL, eventAddress } from "@doriface/protocol";
import { endSweeper } from "./end-sweeper.ts";
import { spawnHcLink } from "./mesh/hc-machines.ts";
import { createHcSession, stopLeftoverCores } from "./testing/hc-session.ts";

const session = createHcSession("end-sweep");
const core = { hc: session.hc, session: session.name, env: session.env };

afterAll(async () => {
  await session.dispose();
  await stopLeftoverCores();
});

/** A client of the core with every removal it has seen, in order. */
async function observe() {
  const connection = await HcConnection.open(spawnHcLink(core));
  const removed: string[] = [];
  const waiting = new Map<string, () => void>();
  const feed = await connection.subscribe();
  feed.onEvent((event) => {
    const address = eventAddress(event);
    if (event.type !== "removed" || address === undefined) return;
    removed.push(address);
    waiting.get(address)?.();
  });
  const start = async (): Promise<string> =>
    (await connection.call("terminal.run", { argv: ["sh", "-c", "exec sleep 600"] })).address;
  const mark = (address: string) =>
    connection.call("terminal.label", { terminal: address, labels: { [END_LABEL]: "1" } });
  const kill = (address: string) => connection.call("terminal.kill", { terminal: address });
  const gone = (address: string): Promise<void> => {
    if (removed.includes(address)) return Promise.resolve();
    const done = Promise.withResolvers<void>();
    waiting.set(address, done.resolve);
    return done.promise;
  };
  const listed = async (): Promise<string[]> =>
    (await connection.call("terminal.list", { all: true })).terminals.map((terminal) => terminal.address);
  return { connection, removed, start, mark, kill, gone, listed };
}

test("the host removes a finished terminal carrying the End label, whether marked before or after it finished", async () => {
  const client = await observe();
  const sweeper = endSweeper(core, () => {});
  try {
    // Finished and marked before the host watches: found when it starts.
    const early = await client.start();
    await client.kill(early);
    await client.mark(early);
    sweeper.ensure();
    await client.gone(early);

    const unmarked = await client.start();
    const markedFirst = await client.start();
    const killedFirst = await client.start();
    await client.kill(unmarked);
    await client.mark(markedFirst);
    await client.kill(markedFirst);
    await client.kill(killedFirst);
    await client.mark(killedFirst);
    await client.gone(markedFirst);
    await client.gone(killedFirst);
    // The host acts on events in order, so it has seen `unmarked` finish and left it.
    expect(client.removed).toEqual([early, markedFirst, killedFirst]);
    expect(await client.listed()).toContain(unmarked);
  } finally {
    await sweeper.stop();
    client.connection.close();
  }
}, 30_000);
