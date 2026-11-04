import type { EventFeed, HcConnection } from "@doriface/client";
import { generateX25519 } from "@doriface/crypto";
import { HcRpcError, isJsonObject, parseJson, type JsonObject, type JsonValue } from "@doriface/protocol";
import {
  editTab,
  LAYOUT_DOC,
  LayoutDoc,
  splitPane,
  tabsOf,
  terminalBlock,
  type DocCalls,
} from "@doriface/protocol/layout";
import { afterAll, describe, expect, test } from "bun:test";
import { type RelayedHost, startRelayedHost } from "./support/relayed-host.ts";
import { setUpOnce } from "./support/set-up-once.ts";
import { type EventWatch, watchEvents } from "./support/watch.ts";

// A document herdr-app 0.1.12 wrote: two tabs, one split four levels deep, the other beside a herdr-app panel.
const FIXTURE = parseJson(
  await Bun.file(new URL("../../packages/protocol/src/layout/fixtures/herdr-app-0.1.12.json", import.meta.url)).text(),
);
const DEEP_TAB = "tbff1e9c7fe9d99f6cd247be825a5da61a";
const DEEPEST = "p986c8fa4187d4d895e540c2850573fac";
const OTHER_TAB = "tb75ab417b08a576fc183e9e363e046aab";
const OTHER_PANE = "pa1ac18cbd58508cb4e5871c0f7741528";

interface Device {
  readonly hc: HcConnection;
  readonly feed: EventFeed;
  readonly events: EventWatch;
  readonly conflicts: () => number;
  readonly layout: LayoutDoc;
}

let relayed: RelayedHost | undefined;
const devices: Device[] = [];

/** The web app's own sync over one relayed connection, counting the writes the core refused as conflicts. */
async function device(name: string): Promise<Device> {
  if (relayed === undefined) throw new Error("setup failed");
  const key = generateX25519();
  await relayed.pair(key, name);
  const hc = await relayed.connect(key);
  const feed = await hc.subscribe();
  let conflicts = 0;
  const calls: DocCalls = {
    get: (on) => hc.call("doc.get", on === null ? { name: LAYOUT_DOC } : { name: LAYOUT_DOC, on }),
    set: (on, value, version) =>
      hc.call("doc.set", on === null ? { name: LAYOUT_DOC, value, version } : { name: LAYOUT_DOC, on, value, version }),
  };
  const counted: DocCalls = {
    get: calls.get,
    set: (on, value, version) =>
      calls.set(on, value, version).catch((cause: unknown) => {
        if (cause instanceof HcRpcError && cause.kind === "conflict") conflicts += 1;
        throw cause;
      }),
  };
  const layout = new LayoutDoc(counted, null, () => undefined);
  await layout.refresh();
  return { hc, feed, events: watchEvents(feed), conflicts: () => conflicts, layout };
}

setUpOnce(async () => {
  relayed = await startRelayedHost("relay-layout");
  devices.push(await device("laptop"), await device("phone"));
}, 120_000);

afterAll(async () => {
  for (const { feed, hc } of devices) {
    feed.close();
    hc.close();
  }
  await relayed?.stop();
});

const pair = (): readonly [Device, Device] => {
  const [a, b] = devices;
  if (a === undefined || b === undefined) throw new Error("setup failed");
  return [a, b];
};

const splitIn = (tab: string, target: string, pane: string) => (doc: JsonObject | null) =>
  doc === null
    ? null
    : editTab(doc, tab, (root) => splitPane(root, target, "row", terminalBlock(pane, "t9"), `s-${pane}`));

function panesIn(value: JsonValue, tab: string): readonly string[] {
  if (!isJsonObject(value)) return [];
  const found = tabsOf(value).find((each) => each.id === tab);
  return found === undefined ? [] : (JSON.stringify(found.root).match(/"id":"p[^"]*"/g) ?? []);
}

describe("the herdr-app layout document, two devices through the relay", () => {
  test("a tree one device writes reaches the other live, by the core's doc event through the relay", async () => {
    const [a, b] = pair();
    expect(await a.layout.edit(() => (isJsonObject(FIXTURE) ? FIXTURE : null))).toBe(true);
    const heard = await b.events.next("doc");
    expect(heard.data).toMatchObject({ name: LAYOUT_DOC });
    if (heard.type !== "doc") throw new Error("not a doc event");
    await b.layout.heard(heard.data.version);
    const state = b.layout.state;
    expect(JSON.stringify(state.phase === "ready" ? state.doc : null)).toBe(JSON.stringify(FIXTURE));
  }, 60_000);

  test("two devices that split different tabs at once both keep their split, and herdr-app's fields stay", async () => {
    const [a, b] = pair();
    // b has not read a's last write: its compare-and-set is refused and its split is made again on a's document.
    const written = await a.layout.edit(splitIn(DEEP_TAB, DEEPEST, "p-from-laptop"));
    const raced = await b.layout.edit(splitIn(OTHER_TAB, OTHER_PANE, "p-from-phone"));
    expect([written, raced]).toEqual([true, true]);
    expect(b.conflicts()).toBeGreaterThanOrEqual(1);
    const { value } = await a.hc.call("doc.get", { name: LAYOUT_DOC });
    expect(panesIn(value, DEEP_TAB)).toContain('"id":"p-from-laptop"');
    expect(panesIn(value, OTHER_TAB)).toContain('"id":"p-from-phone"');
    const fields = JSON.stringify(value);
    for (const kept of ['"mod":"files"', '"name":"build"', '"folder":"/home/user/project"', '"weight":0.5']) {
      expect(fields).toContain(kept);
    }
  }, 60_000);

  test("two devices that split the same tab at once both keep their split", async () => {
    const [a, b] = pair();
    await b.layout.refresh();
    await a.layout.refresh();
    const [first, second] = await Promise.all([
      a.layout.edit(splitIn(DEEP_TAB, DEEPEST, "p-same-a")),
      b.layout.edit(splitIn(DEEP_TAB, DEEPEST, "p-same-b")),
    ]);
    expect([first, second]).toEqual([true, true]);
    const { value } = await b.hc.call("doc.get", { name: LAYOUT_DOC });
    expect(panesIn(value, DEEP_TAB)).toEqual(expect.arrayContaining(['"id":"p-same-a"', '"id":"p-same-b"']));
  }, 60_000);
});
