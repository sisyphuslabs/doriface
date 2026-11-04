import { base64urlDecode, bytesEqual } from "@doriface/crypto";
import type { PushSubscriptionKeys } from "@doriface/protocol";

/** What the app and the worker read off a browser subscription; a stand-in in tests has the same two members. */
export interface SubscriptionLike {
  readonly endpoint: string;
  toJSON(): PushSubscriptionJSON;
}

/** base64url without padding, as the host's parser takes it, from whatever padding the browser used. */
const unpadded = (value: string): string => value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export function keysOf(subscription: SubscriptionLike): PushSubscriptionKeys {
  const json = subscription.toJSON();
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (p256dh === undefined || auth === undefined) throw new Error("the browser's subscription has no keys");
  return { endpoint: subscription.endpoint, p256dh: unpadded(p256dh), auth: unpadded(auth) };
}

/** Whether the browser subscribed with this host's VAPID key. */
export function sameKey(subscription: PushSubscription, vapidKey: string): boolean {
  const key = subscription.options.applicationServerKey;
  return key !== null && bytesEqual(new Uint8Array(key), base64urlDecode(vapidKey));
}

/** Duck-typed: a worker event's subscription, or anything else (null, a missing member). */
export function asSubscription(value: unknown): SubscriptionLike | null {
  if (typeof value !== "object" || value === null) return null;
  const endpoint = Reflect.get(value, "endpoint");
  const toJSON = Reflect.get(value, "toJSON");
  if (typeof endpoint !== "string" || typeof toJSON !== "function") return null;
  return { endpoint, toJSON: () => Reflect.apply(toJSON, value, []) };
}
