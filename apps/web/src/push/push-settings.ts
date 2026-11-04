import { base64urlDecode, bytesEqual } from "@doriface/crypto";
import { DEFAULT_PUSH_PREFS, type PushHostLine, type PushPrefs, type PushSubscriptionKeys } from "@doriface/protocol";
import { useSyncExternalStore } from "react";
import { connectionStore } from "../connection/store.ts";
import { pushChannel } from "./push-channel.ts";
import { loadPushRoute, routeOf, savePushRoute } from "./push-route.ts";
import { browserScope, type PushSupport, pushSupport } from "./push-support.ts";

export interface PushView {
  readonly support: PushSupport;
  /** The browser's notification permission; null where there is none. */
  readonly permission: NotificationPermission | null;
  readonly on: boolean;
  readonly prefs: PushPrefs;
  readonly busy: boolean;
  readonly error: string | null;
  /** Set once a test notice was handed to the push service. */
  readonly tested: boolean;
}

const INITIAL: PushView = {
  support: "unsupported",
  permission: null,
  on: false,
  prefs: DEFAULT_PUSH_PREFS,
  busy: true,
  error: null,
  tested: false,
};

/** base64url without padding, as the host's parser takes it, from whatever padding the browser used. */
const unpadded = (value: string): string => value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function keysOf(subscription: PushSubscription): PushSubscriptionKeys {
  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (p256dh === undefined || auth === undefined) throw new Error("the browser's subscription has no keys");
  return { endpoint: subscription.endpoint, p256dh: unpadded(p256dh), auth: unpadded(auth) };
}

function expect(reply: PushHostLine, what: string): void {
  if (reply.t === "error") throw new Error(`The host refused to ${what}: ${reply.reason}`);
}

const sameKey = (subscription: PushSubscription, vapidKey: string): boolean => {
  const key = subscription.options.applicationServerKey;
  return key !== null && bytesEqual(new Uint8Array(key), base64urlDecode(vapidKey));
};

/** Settings > Notifications: this device's permission, its subscription on the host, and what it asks to hear. */
class PushSettings {
  #view: PushView = INITIAL;
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get view(): PushView {
    return this.#view;
  }

  /** Reads the state; never asks for permission. A subscription the host lost is handed to it again. */
  async load(): Promise<void> {
    const support = pushSupport(browserScope());
    const permission = support === "supported" ? Notification.permission : null;
    this.#set({ support, permission });
    if (support !== "supported") return this.#set({ busy: false });
    await this.#run("read the notification settings", async () => {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      const route = await loadPushRoute();
      if (subscription === null || route === undefined || permission !== "granted") {
        if (route !== undefined) await savePushRoute(null);
        return this.#set({ on: false });
      }
      const ready = await pushChannel.request({ t: "hello" }, route);
      if (ready.t !== "ready") throw new Error("the host did not answer");
      const held = ready.subscriptions.find((entry) => entry.endpoint === subscription.endpoint);
      if (held === undefined || !sameKey(subscription, ready.vapidKey)) return this.#set({ on: false });
      this.#set({ on: true, prefs: held.prefs });
    });
  }

  /** Runs from the Turn on click: the only place this app asks for the notification permission. */
  async turnOn(): Promise<void> {
    const permission = await Notification.requestPermission();
    this.#set({ permission });
    if (permission !== "granted") return;
    await this.#run("turn notifications on", async () => {
      const route = routeOf(connectionStore.settings);
      const ready = await pushChannel.request({ t: "hello" }, route);
      if (ready.t !== "ready") throw new Error("the host did not answer");
      const manager = (await navigator.serviceWorker.ready).pushManager;
      let subscription = await manager.getSubscription();
      if (subscription !== null && !sameKey(subscription, ready.vapidKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await manager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: new Uint8Array(base64urlDecode(ready.vapidKey)),
      });
      const prefs = this.#view.prefs;
      expect(
        await pushChannel.request({ t: "subscribe", subscription: keysOf(subscription), prefs }, route),
        "subscribe",
      );
      await savePushRoute(route);
      this.#set({ on: true });
    });
  }

  /** Removes the subscription from the host and the browser; the permission itself stays the browser's. */
  async turnOff(): Promise<void> {
    await this.#run("turn notifications off", async () => {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription !== null) {
        await pushChannel.request({ t: "unsubscribe", endpoint: subscription.endpoint }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      await savePushRoute(null);
      this.#set({ on: false, tested: false });
    });
  }

  async setPrefs(prefs: PushPrefs): Promise<void> {
    const before = this.#view.prefs;
    this.#set({ prefs });
    await this.#run("save the notification settings", async () => {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription === null) return;
      const reply = await pushChannel.request({ t: "prefs", endpoint: subscription.endpoint, prefs });
      if (reply.t === "error") this.#set({ prefs: before });
      expect(reply, "save the settings");
    });
  }

  async test(): Promise<void> {
    await this.#run("send a test notification", async () => {
      const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (subscription === null) throw new Error("this device has no subscription");
      expect(await pushChannel.request({ t: "test", endpoint: subscription.endpoint }), "send a test notification");
      this.#set({ tested: true });
    });
  }

  async #run(what: string, step: () => Promise<void>): Promise<void> {
    this.#set({ busy: true, error: null });
    try {
      await step();
      this.#set({ busy: false });
    } catch (error) {
      this.#set({ busy: false, error: `Could not ${what}. ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  #set(change: Partial<PushView>): void {
    this.#view = { ...this.#view, ...change };
    for (const listener of this.#listeners) listener();
  }
}

export const pushSettings = new PushSettings();

export const usePushSettings = (): PushView => useSyncExternalStore(pushSettings.subscribe, () => pushSettings.view);
