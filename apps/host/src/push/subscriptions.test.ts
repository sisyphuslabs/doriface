import { DEFAULT_PUSH_PREFS } from "@doriface/protocol";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOOPBACK_OWNER, MAX_PER_OWNER, SubscriptionStore } from "./subscriptions.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-push-store-"));
  dirs.push(dir);
  return { dir, store: new SubscriptionStore(dir) };
};
const keys = (endpoint: string) => ({ endpoint, p256dh: "B".repeat(87), auth: "C".repeat(22) });

describe("push-subscriptions.json", () => {
  test("is private to the owner (0600)", () => {
    const { dir, store: s } = store();
    s.put("device-a", keys("https://fcm.googleapis.com/a"), DEFAULT_PUSH_PREFS);
    expect(statSync(join(dir, "push-subscriptions.json")).mode & 0o777).toBe(0o600);
  });

  test("an endpoint has one owner: subscribing again moves it", () => {
    const { store: s } = store();
    s.put("device-a", keys("https://fcm.googleapis.com/a"), DEFAULT_PUSH_PREFS);
    s.put("device-b", keys("https://fcm.googleapis.com/a"), DEFAULT_PUSH_PREFS);
    expect(s.list().map((entry) => entry.owner)).toEqual(["device-b"]);
  });

  test("a device keeps its newest subscriptions up to the cap", () => {
    const { store: s } = store();
    for (let i = 0; i <= MAX_PER_OWNER; i++)
      s.put("device-a", keys(`https://fcm.googleapis.com/${i}`), DEFAULT_PUSH_PREFS);
    const endpoints = s.ofOwner("device-a").map((entry) => entry.endpoint);
    expect(endpoints).toHaveLength(MAX_PER_OWNER);
    expect(endpoints).not.toContain("https://fcm.googleapis.com/0");
  });

  test("a revoke drops that device's subscriptions and keeps the loopback client's", () => {
    const { store: s } = store();
    s.put("device-a", keys("https://fcm.googleapis.com/a"), DEFAULT_PUSH_PREFS);
    s.put("device-b", keys("https://fcm.googleapis.com/b"), DEFAULT_PUSH_PREFS);
    s.put(LOOPBACK_OWNER, keys("https://fcm.googleapis.com/l"), DEFAULT_PUSH_PREFS);
    s.keepOwners(new Set(["device-b"]));
    expect(
      s
        .list()
        .map((entry) => entry.owner)
        .toSorted(),
    ).toEqual(["device-b", LOOPBACK_OWNER].toSorted());
  });
});
