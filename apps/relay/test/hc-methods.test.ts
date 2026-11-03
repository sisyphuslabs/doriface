import type { EventFeed, HcConnection } from "@doriface/client";
import { generateX25519 } from "@doriface/crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type RelayedHost, startRelayedHost } from "./support/relayed-host.ts";
import { type EventWatch, watchEvents, watchScreen, within } from "./support/watch.ts";

const phone = generateX25519();
let relayed: RelayedHost | undefined;
let connection: HcConnection | undefined;
let feed: EventFeed | undefined;
let watched: EventWatch | undefined;

const text = (base64: string): string => Buffer.from(base64, "base64").toString("utf8");

function started(): { readonly hc: HcConnection; readonly events: EventWatch; readonly dir: string } {
  if (relayed === undefined || connection === undefined || watched === undefined) throw new Error("setup failed");
  return { hc: connection, events: watched, dir: join(relayed.scratch, "work") };
}

beforeAll(async () => {
  relayed = await startRelayedHost("doriface-relay-methods");
  mkdirSync(join(relayed.scratch, "work"));
  await relayed.pair(phone, "methods");
  connection = await relayed.connect(phone);
  feed = await connection.subscribe();
  watched = watchEvents(feed);
}, 120_000);

afterAll(async () => {
  feed?.close();
  connection?.close();
  await relayed?.stop();
});

describe("every hc method family, client SDK -> Noise IK -> relay -> doriface-host -> hc", () => {
  test("terminal.run, list, get, attach (typing), send, keys, read, label, kill and rm, with their events", async () => {
    const { hc, events, dir } = started();
    const run = await hc.call("terminal.run", { argv: ["/bin/sh"], cwd: dir, env: { PS1: "$ ", HOME: dir } });
    const address = run.address;
    expect((await events.next("created", address)).terminal).toBe(address);
    expect((await hc.call("terminal.list")).terminals.map((terminal) => terminal.address)).toContain(address);
    const got = await hc.call("terminal.get", { terminal: address });
    expect([got.address, got.state]).toEqual([address, "live"]);

    const stream = await hc.attach({ terminal: address, cols: 100, rows: 30 });
    const screen = watchScreen(stream);
    stream.write("echo typed-$((40 + 2))\r");
    await screen.line("typed-42");
    await hc.call("terminal.send", { terminal: address, text: "echo sent-$((1 + 1))" });
    await screen.line("sent-2");
    await hc.call("terminal.keys", { terminal: address, keys: ["e", "c", "h", "o", "space", "k", "9", "enter"] });
    await screen.line("k9");
    const read = await hc.call("terminal.read", { terminal: address });
    expect(read.text.split("\n").map((line) => line.trim())).toEqual(expect.arrayContaining(["sent-2", "k9"]));

    const labelled = await hc.call("terminal.label", { terminal: address, labels: { suite: "relay" } });
    expect(labelled.labels).toEqual({ suite: "relay" });
    expect((await events.next("labels", address)).data).toMatchObject({ labels: { suite: "relay" } });

    const closed = within(new Promise((resolve) => stream.onClose(resolve)), "the attach stream closing");
    const killed = await hc.call("terminal.kill", { terminal: address });
    expect(killed.state).toBe("finished");
    await events.next("finished", address);
    expect(await closed).toMatchObject({ by: "core", reason: "killed" });
    expect((await hc.call("terminal.rm", { terminal: address })).removed).toBe(address);
    await events.next("removed", address);
  }, 60_000);

  test("terminal.wait returns the exit of a program that finished", async () => {
    const { hc, events, dir } = started();
    const run = await hc.call("terminal.run", { argv: ["/bin/sh", "-c", "exit 3"], cwd: dir, keep: false });
    const waited = await hc.call("terminal.wait", { terminal: run.address, timeout: 15 });
    expect([waited.ended, waited.exit_code]).toEqual([true, 3]);
    await events.next("finished", run.address);
  }, 30_000);

  test("machine.exec runs a command and returns its exit, stdout and stderr", async () => {
    const { hc, dir } = started();
    const exec = await hc.call("machine.exec", {
      argv: ["/bin/sh", "-c", "printf exec-ok; printf exec-err >&2; exit 4"],
      cwd: dir,
    });
    expect([exec.code, text(exec.stdout), text(exec.stderr), exec.timed_out]).toEqual([
      4,
      "exec-ok",
      "exec-err",
      false,
    ]);
  }, 30_000);

  test("file.write, file.read and file.edit change a real file on the host", async () => {
    const { hc, dir } = started();
    const path = join(dir, "note.txt");
    const data = Buffer.from("alpha\nbeta\n").toString("base64");
    expect((await hc.call("file.write", { path, data })).bytes).toBe(11);
    expect((await hc.call("file.read", { path })).text).toContain("beta");
    await hc.call("file.edit", { path, edits: [{ old: "beta", new: "gamma" }] });
    expect(readFileSync(path, "utf8")).toBe("alpha\ngamma\n");
    expect((await hc.call("file.read", { path })).text).toContain("gamma");
  }, 30_000);

  test("doc.set and doc.get round-trip a versioned document, and subscribers hear of it", async () => {
    const { hc, events } = started();
    const name = "relay-doc";
    expect((await hc.call("doc.get", { name })).version).toBe(0);
    const set = await hc.call("doc.set", { name, value: { panes: ["t1"] }, version: 0 });
    expect(set.version).toBe(1);
    expect(await hc.call("doc.get", { name })).toEqual({ value: { panes: ["t1"] }, version: 1 });
    expect((await events.next("doc")).data).toMatchObject({ name, version: 1 });
  }, 30_000);

  test("machine.list and rpc.discover answer through the relay", async () => {
    const { hc } = started();
    expect((await hc.call("machine.list")).machines).toEqual([]);
    const discovered: unknown = await hc.call("rpc.discover");
    const methods =
      typeof discovered === "object" && discovered !== null && "methods" in discovered ? discovered.methods : [];
    const names = Array.isArray(methods)
      ? methods.map((method: unknown) =>
          typeof method === "object" && method !== null && "name" in method ? method.name : undefined,
        )
      : [];
    expect(names).toEqual(expect.arrayContaining([...hc.hello.methods]));
  }, 30_000);
});
