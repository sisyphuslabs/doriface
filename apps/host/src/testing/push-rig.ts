import type { HcEvent, JsonValue, Status, Terminal } from "@doriface/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptPushBody, type ReceiverKeys, receiverKeys } from "./push-receiver.ts";
import type { PushFetch } from "../push/deliver.ts";
import { type PushCore, PushService } from "../push/push-service.ts";
import { SubscriptionStore } from "../push/subscriptions.ts";
import { loadVapidKey } from "../push/vapid-key.ts";

export const HOST_ID = "abcdefghijklmnopqrstuvwxyz";
export const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";

export const terminal = (address: string, status: Status | null, fields: Partial<Terminal> = {}): Terminal => ({
  address,
  argv: ["agent"],
  cols: 80,
  rows: 24,
  created_ms: 1,
  cwd: "/work",
  labels: {},
  screen: "exact",
  state: "live",
  status,
  status_ms: 1_000,
  turn: 2,
  ...fields,
});

let seq = 1;
export const statusEvent = (address: string, status: Status | null, machine?: string): HcEvent => ({
  type: "status",
  seq: seq++,
  terminal: address,
  ...(machine === undefined ? {} : { machine }),
  data: { status, records: {}, reported: true },
});

/** A core holding terminals and screens in memory, recording the keys an answer sends. */
export class FakeCore implements PushCore {
  readonly terminals = new Map<string, Terminal>();
  readonly screens = new Map<string, string>();
  readonly sent: { readonly terminal: string; readonly keys: readonly string[] }[] = [];

  async terminal(address: string): Promise<Terminal> {
    const found = this.terminals.get(address);
    if (found === undefined) throw new Error(`no terminal ${address}`);
    return found;
  }

  async screen(address: string): Promise<string> {
    return this.screens.get(address) ?? "";
  }

  async keys(address: string, keys: readonly string[]): Promise<void> {
    await Promise.resolve();
    this.sent.push({ terminal: address, keys });
  }

  readonly #docs = new Map<string, { value: JsonValue; version: number }>();

  /** As hc 0.1.17's documents: `doc.set` is a compare-and-set on the version read; every call yields first. */
  async doc(name: string, on: string | undefined): Promise<{ readonly value: JsonValue; readonly version: number }> {
    await Promise.resolve();
    return this.#docs.get(`${on ?? ""}:${name}`) ?? { value: null, version: 0 };
  }

  async setDoc(name: string, on: string | undefined, value: JsonValue, version: number): Promise<"ok" | "conflict"> {
    await Promise.resolve();
    const key = `${on ?? ""}:${name}`;
    const current = this.#docs.get(key)?.version ?? 0;
    if (current !== version) return "conflict";
    this.#docs.set(key, { value, version: current + 1 });
    return "ok";
  }
}

export interface Posted {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface Rig {
  readonly service: PushService;
  readonly store: SubscriptionStore;
  readonly core: FakeCore;
  readonly posted: Posted[];
  readonly keys: ReceiverKeys;
  readonly paired: Set<string>;
  status: number;
  /** Decrypts each posted body as the subscribed browser would. */
  notices(): Promise<unknown[]>;
  close(): void;
}

export async function rig(): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), "dh-push-"));
  const store = new SubscriptionStore(dir);
  const core = new FakeCore();
  const posted: Posted[] = [];
  const paired = new Set(["device-a", "device-b"]);
  const keys = await receiverKeys();
  const state = { status: 201 };
  const post: PushFetch = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    posted.push({ url, headers, body: new Uint8Array(await new Response(init.body).arrayBuffer()) });
    return new Response(null, { status: state.status });
  };
  const service = new PushService({
    hostId: HOST_ID,
    vapid: await loadVapidKey(dir),
    subscriptions: store,
    paired: () => paired,
    post,
    log: () => {},
  });
  service.attach(core);
  return {
    service,
    store,
    core,
    posted,
    keys,
    paired,
    get status() {
      return state.status;
    },
    set status(value: number) {
      state.status = value;
    },
    notices: () =>
      Promise.all(
        posted.map(async (entry) => JSON.parse(new TextDecoder().decode(await decryptPushBody(entry.body, keys)))),
      ),
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
