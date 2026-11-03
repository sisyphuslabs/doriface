import { type EventFeed, HcConnection } from "@doriface/client";
import { generateHostIdentity, generateX25519 } from "@doriface/crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessLink } from "../../packages/client/src/testing/process-link.ts";
import { KnownHosts } from "../../apps/host/src/state/known-hosts.ts";
import { createHcSession, type HcSession } from "../../apps/host/src/testing/hc-session.ts";
import { connectCommand, runConnect } from "./support/connect-cli.ts";
import { type RelayedHost, startRelayedHost } from "./support/relayed-host.ts";
import { type EventWatch, watchEvents, watchScreen, within } from "./support/watch.ts";

const scratch = mkdtempSync(join(tmpdir(), "madd-"));
const deviceA = join(scratch, "device-a");
const phone = generateX25519();
let machineB: RelayedHost | undefined;
let coreA: HcSession | undefined;
let clientA: HcConnection | undefined;
let clientB: HcConnection | undefined;
let feedA: EventFeed | undefined;
let eventsA: EventWatch | undefined;

interface Setup {
  readonly a: HcConnection;
  readonly b: HcConnection;
  readonly coreA: HcSession;
  readonly machineB: RelayedHost;
  readonly eventsA: EventWatch;
  readonly feedA: EventFeed;
}

function setup(): Setup {
  if (machineB === undefined || coreA === undefined || clientA === undefined || clientB === undefined) {
    throw new Error("setup failed");
  }
  if (eventsA === undefined || feedA === undefined) throw new Error("setup failed");
  return { a: clientA, b: clientB, coreA, machineB, eventsA, feedA };
}

function openCore(session: HcSession): Promise<HcConnection> {
  const proc = Bun.spawn([session.hc, "connect", "--session", session.name], {
    env: session.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  return HcConnection.open(new ProcessLink(proc));
}

beforeAll(async () => {
  machineB = await startRelayedHost("doriface-machine-b");
  mkdirSync(join(machineB.scratch, "work"));
  await machineB.pair(phone, "b's own client");
  clientB = await machineB.connect(phone);
  coreA = createHcSession("doriface-machine-a");
  clientA = await openCore(coreA);
  feedA = await clientA.subscribe();
  eventsA = watchEvents(feedA);
  const pairing = runConnect(deviceA, machineB.relayUrl, await machineB.pairingLink(), "--name", "machine-a");
  pairing.end();
  if ((await pairing.exited) !== 0) throw new Error(`pairing A with B failed: ${await pairing.stderr()}`);
}, 120_000);

afterAll(async () => {
  feedA?.close();
  clientA?.close();
  clientB?.close();
  await coreA?.dispose();
  await machineB?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

async function hcAdd(core: HcSession, via: string, name: string) {
  const add = Bun.spawn([core.hc, "machine", "add", "--via", via, "--name", name, "--json"], {
    env: core.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(add.stdout).text(),
    new Response(add.stderr).text(),
    add.exited,
  ]);
  return { stdout, stderr, exit };
}

describe("hc machine add --via 'doriface-host connect <hostId>': machine A's hc reaches machine B through the relay", () => {
  test("a host that is not on the relay makes hc's add fail fast with the bridge's reason, and adds nothing", async () => {
    const { a, coreA: core, machineB: hostB } = setup();
    const absent = generateHostIdentity();
    new KnownHosts(deviceA).add({ hostId: absent.hostId, hostKey: absent.noise.publicKey, relayUrl: hostB.relayUrl });
    const startedAt = performance.now();
    const refused = await within(
      hcAdd(core, connectCommand(deviceA, hostB.relayUrl, absent.hostId), "gone"),
      "hc's add",
    );
    expect(performance.now() - startedAt).toBeLessThan(5_000);
    expect(refused.exit).not.toBe(0);
    expect(JSON.parse(refused.stderr)).toMatchObject({ error: { kind: "unreachable" } });
    expect(refused.stderr).toContain("is not connected to the relay");
    expect((await a.call("machine.list")).machines).toEqual([]);
  }, 30_000);

  test("B's terminals show up on A as boxb/t1, run and attach work from A's client, and its terminal and doc events reach A", async () => {
    const { a, b, coreA: core, machineB: hostB, eventsA: events } = setup();
    const dir = join(hostB.scratch, "work");
    const before = await b.call("terminal.run", { argv: ["/bin/sh"], cwd: dir, env: { PS1: "$ ", HOME: dir } });
    expect(before.address).toBe("t1");

    const via = connectCommand(deviceA, hostB.relayUrl, hostB.hostId);
    const startedAt = performance.now();
    const add = Bun.spawn([core.hc, "machine", "add", "--via", via, "--name", "boxb", "--json"], {
      env: core.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [added, addErr, addExit] = await Promise.all([
      new Response(add.stdout).text(),
      new Response(add.stderr).text(),
      add.exited,
    ]);
    const addMs = performance.now() - startedAt;
    expect({ addExit, addErr }).toEqual({ addExit: 0, addErr: "" });
    expect(JSON.parse(added)).toMatchObject({ name: "boxb", via: true, id: b.hello.core.id });
    expect(addMs).toBeLessThan(20_000);

    const remote = await a.call("terminal.get", { terminal: "boxb/t1" });
    expect([remote.address, remote.state]).toEqual(["boxb/t1", "live"]);
    expect((await a.call("terminal.list")).terminals.map((terminal) => terminal.address)).toContain("boxb/t1");
    const machines = await a.call("machine.list");
    expect(machines.machines.map(({ name, state }) => [name, state])).toEqual([["boxb", "connected"]]);

    const run = await a.call("terminal.run", {
      argv: ["/bin/sh"],
      on: "boxb",
      cwd: dir,
      env: { PS1: "$ ", HOME: dir },
    });
    expect(run.address).toBe("boxb/t2");
    expect(await events.next("created", "boxb/t2")).toMatchObject({
      terminal: "boxb/t2",
      data: { address: "boxb/t2" },
    });
    const stream = await a.attach({ terminal: "boxb/t2", cols: 100, rows: 30 });
    const screen = watchScreen(stream);
    stream.write("echo from-a-on-$((10 + 1))\r");
    await screen.line("from-a-on-11");
    expect((await b.call("terminal.read", { terminal: "t2" })).text).toContain("from-a-on-11");

    await a.call("terminal.kill", { terminal: "boxb/t2" });
    await events.next("finished", "boxb/t2");
    const doc = await a.call("doc.set", { name: "layout", on: "boxb", value: { from: "a" }, version: 0 });
    expect(await b.call("doc.get", { name: "layout" })).toEqual({ value: { from: "a" }, version: doc.version });
    expect((await events.next("doc")).machine).toBe("boxb");
    expect((await a.call("machine.rm", { machine: "boxb" })).removed).toBe("boxb");
    expect((await a.call("machine.list")).machines).toEqual([]);
    expect((await within(b.call("terminal.get", { terminal: "t1" }), "B still answering")).state).toBe("live");
  }, 90_000);
});
