import { DeviceStore } from "../state/devices.ts";

/**
 * A separate process for the lock race test: `add <dir> <prefix> <count>` pairs fresh keys one at a time;
 * `revoke <dir> <key>...` revokes each key one at a time. Each step takes the state lock on its own.
 */
const [op, dir, ...rest] = process.argv.slice(2);
if (dir === undefined) throw new Error("usage: devices-worker add|revoke <dir> ...");
const store = new DeviceStore(dir, { lockTimeoutMs: 10_000 });
if (op === "add") {
  const [prefix, count] = rest;
  for (let i = 0; i < Number(count); i++) {
    store.add(crypto.getRandomValues(new Uint8Array(32)), `${prefix}-${i}`);
  }
} else if (op === "revoke") {
  for (const key of rest) if (store.revoke(key).length !== 1) throw new Error(`not revoked: ${key}`);
} else throw new Error(`unknown op ${String(op)}`);
