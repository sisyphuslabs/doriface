import { HcConnection } from "@doriface/client";
import { HOST_INFO_DOC, type JsonValue } from "@doriface/protocol";
import { expect, test } from "bun:test";
import { publishHostInfo } from "./host-info.ts";
import { spawnHcLink } from "./mesh/hc-machines.ts";
import { createHcSession } from "./testing/hc-session.ts";

async function withCore<T>(session: ReturnType<typeof createHcSession>, use: (core: HcConnection) => Promise<T>) {
  const link = spawnHcLink({ hc: session.hc, session: session.name, env: session.env });
  const core = await HcConnection.open(link);
  try {
    return await use(core);
  } finally {
    core.close();
    link.close();
  }
}

const docOf = (session: ReturnType<typeof createHcSession>): Promise<JsonValue> =>
  withCore(session, async (core) => (await core.call("doc.get", { name: HOST_INFO_DOC })).value);

test("a host writes its OS on its own core, over a child that has exited once it settles", async () => {
  const session = createHcSession("dh-info");
  try {
    const target = { hc: session.hc, session: session.name, env: session.env };
    // Another OS was there (the machine was reinstalled): the host writes over it at the version it read.
    await withCore(session, (core) =>
      core.call("doc.set", { name: HOST_INFO_DOC, value: { v: 1, os: "linux" }, version: 0 }),
    );
    let exited = false;
    const publisher = publishHostInfo(
      target,
      "darwin",
      () => {},
      (core) => {
        const link = spawnHcLink(core);
        link.onClose(() => (exited = true));
        return link;
      },
    );
    await publisher.settled;
    expect(await docOf(session)).toEqual({ v: 1, os: "darwin" });
    expect(exited).toBe(true);
  } finally {
    await session.dispose();
  }
}, 30_000);

test("a host on an OS the document does not name writes nothing", async () => {
  const session = createHcSession("dh-info-none");
  try {
    const logs: string[] = [];
    await publishHostInfo({ hc: session.hc, session: session.name, env: session.env }, "freebsd", (line) =>
      logs.push(line),
    ).settled;
    expect(await docOf(session)).toBeNull();
    expect(logs).toEqual([]);
  } finally {
    await session.dispose();
  }
}, 30_000);
