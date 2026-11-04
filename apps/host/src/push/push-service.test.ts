import { DEFAULT_PUSH_PREFS } from "@doriface/protocol";
import { afterEach, describe, expect, test } from "bun:test";
import { verifyVapid } from "../testing/push-receiver.ts";
import { ENDPOINT, HOST_ID, type Rig, rig, statusEvent, terminal } from "../testing/push-rig.ts";

const rigs: Rig[] = [];
afterEach(() => {
  for (const each of rigs.splice(0)) each.close();
});

async function subscribed(owner = "device-a", endpoint = ENDPOINT): Promise<Rig> {
  const r = await rig();
  rigs.push(r);
  expect(
    await r.service.subscribe(owner, { endpoint, p256dh: r.keys.p256dh, auth: r.keys.auth }, DEFAULT_PUSH_PREFS),
  ).toBe(true);
  return r;
}

const SECRET = {
  state: "blocked",
  kind: "permission",
  app: "claude",
  msg: "Run rm -rf ~/launch-codes?",
  title: "deploy-prod",
};

describe("a notice's payload", () => {
  // Long, distinctive sentinels: a two-letter one turns up by chance in the random id, signature and ciphertext.
  const MACHINE = "box-sentinel-5d1";
  const TERMINAL = "t7-sentinel-a9c";

  test("is exactly {v,n,k,h}; the status text, title, address and machine never leave the host", async () => {
    const r = await subscribed();
    r.core.terminals.set(`${MACHINE}/${TERMINAL}`, terminal(`${MACHINE}/${TERMINAL}`, SECRET));
    await r.service.event(statusEvent(TERMINAL, SECRET, MACHINE));
    expect(await r.notices()).toEqual([{ v: 1, n: expect.stringMatching(/^[\w-]{22}$/), k: "permission", h: HOST_ID }]);
    const posted = r.posted[0];
    expect(Object.keys(posted?.headers ?? {}).toSorted()).toEqual([
      "authorization",
      "content-encoding",
      "content-type",
      "ttl",
      "urgency",
    ]);
    const wire = JSON.stringify(posted?.headers) + Buffer.from(posted?.body ?? []).toString("latin1");
    for (const plain of ["launch-codes", "deploy-prod", MACHINE, TERMINAL]) expect(wire).not.toContain(plain);
  });

  test("goes to the push service with a VAPID header for that origin and an encrypted body", async () => {
    const r = await subscribed();
    await r.service.event(statusEvent("t1", { state: "done" }));
    const posted = r.posted[0];
    expect(posted?.url).toBe(ENDPOINT);
    expect(posted?.headers).toMatchObject({ "content-encoding": "aes128gcm", urgency: "high", ttl: "86400" });
    const { key, claims } = await verifyVapid(posted?.headers["authorization"] ?? "");
    expect(key).toBe(r.service.vapidKey);
    expect(claims.aud).toBe("https://fcm.googleapis.com");
  });
});

describe("who gets a notice", () => {
  test("a device focused on that terminal gets none; once its stream closes it does", async () => {
    const r = await subscribed();
    const present = r.service.presence("device-a");
    present.focus("t1");
    await r.service.event(statusEvent("t1", { state: "done" }));
    await r.service.event(statusEvent("t2", { state: "done" }));
    expect(r.posted).toHaveLength(1);
    present.leave();
    await r.service.event(statusEvent("t1", { state: "error" }));
    expect(r.posted).toHaveLength(2);
  });

  test("a turned-off event and a muted machine send nothing", async () => {
    const r = await subscribed();
    r.service.setPrefs("device-a", ENDPOINT, {
      events: { ...DEFAULT_PUSH_PREFS.events, done: false },
      muted: ["machine:box"],
    });
    await r.service.event(statusEvent("t1", { state: "done" }));
    await r.service.event(statusEvent("t2", { state: "error" }, "box"));
    expect(r.posted).toHaveLength(0);
    await r.service.event(statusEvent("t3", { state: "error" }));
    expect(r.posted).toHaveLength(1);
  });

  test("a revoked device gets nothing, even before its subscriptions are pruned", async () => {
    const r = await subscribed();
    r.paired.delete("device-a");
    await r.service.event(statusEvent("t1", { state: "done" }));
    expect(r.posted).toHaveLength(0);
  });

  test("an endpoint the push service calls gone is removed", async () => {
    const r = await subscribed();
    r.status = 410;
    await r.service.event(statusEvent("t1", { state: "done" }));
    expect(r.store.list()).toEqual([]);
  });

  test("an endpoint that is no known push service is refused at subscribe", async () => {
    const r = await rig();
    rigs.push(r);
    const keys = { p256dh: r.keys.p256dh, auth: r.keys.auth };
    const endpoints = [
      "https://example.com/push",
      "http://fcm.googleapis.com/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://fcm.googleapis.com:8443/x",
    ];
    const accepted = await Promise.all(
      endpoints.map((endpoint) => r.service.subscribe("device-a", { endpoint, ...keys }, DEFAULT_PUSH_PREFS)),
    );
    expect(accepted).toEqual(endpoints.map(() => false));
    expect(r.store.list()).toEqual([]);
  });
});

describe("answering a permission notice", () => {
  const SCREEN = "Allow Bash(rm -rf build)?\n> 1. Yes\n  2. No";

  async function noticed(): Promise<{ r: Rig; id: string }> {
    const r = await subscribed();
    r.core.terminals.set("t3", terminal("t3", SECRET));
    r.core.screens.set("t3", SCREEN);
    await r.service.event(statusEvent("t3", SECRET));
    const [notice] = await r.notices();
    const id = typeof notice === "object" && notice !== null ? String(Reflect.get(notice, "n")) : "";
    return { r, id };
  }

  test("the notice id resolves to its terminal only on the host", async () => {
    const { r, id } = await noticed();
    expect(r.service.resolve(id)).toMatchObject({ terminal: "t3", kind: "permission" });
  });

  test("Allow sends the agent's own key while the prompt is still on the live screen", async () => {
    const { r, id } = await noticed();
    expect(await r.service.answer(id, "allow")).toEqual({ t: "answered", terminal: "t3" });
    expect(r.core.sent).toEqual([{ terminal: "t3", keys: ["enter"] }]);
  });

  test.each([
    [
      "answered in the terminal first",
      (r: Rig) => r.core.terminals.set("t3", terminal("t3", { state: "working", app: "claude" })),
    ],
    [
      "a new prompt took its place",
      (r: Rig) => r.core.terminals.set("t3", terminal("t3", SECRET, { status_ms: 9_999 })),
    ],
    ["the screen changed", (r: Rig) => r.core.screens.set("t3", "Allow Bash(git push)?\n> 1. Yes")],
  ])("stale when %s: nothing is sent", async (_, change) => {
    const { r, id } = await noticed();
    change(r);
    expect(await r.service.answer(id, "allow")).toEqual({ t: "stale", terminal: "t3" });
    expect(r.core.sent).toEqual([]);
  });

  test("two racing answers send exactly one", async () => {
    const { r, id } = await noticed();
    const replies = await Promise.all([r.service.answer(id, "allow"), r.service.answer(id, "deny")]);
    expect(replies.map((reply) => reply.t).toSorted()).toEqual(["answered", "stale"]);
    expect(r.core.sent).toHaveLength(1);
  });

  test("an agent with no key mapping, or an unknown id, is stale", async () => {
    const r = await subscribed();
    const other = { ...SECRET, app: "my-agent" };
    r.core.terminals.set("t5", terminal("t5", other));
    await r.service.event(statusEvent("t5", other));
    const [notice] = await r.notices();
    const id = typeof notice === "object" && notice !== null ? String(Reflect.get(notice, "n")) : "";
    expect(await r.service.answer(id, "allow")).toEqual({ t: "stale", terminal: "t5" });
    expect(await r.service.answer("AAAAAAAAAAAAAAAAAAAAAA", "allow")).toEqual({ t: "stale", terminal: null });
    expect(r.core.sent).toEqual([]);
  });
});
