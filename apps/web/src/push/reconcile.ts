import type { PushClientLine, PushHostLine, PushPrefs } from "@doriface/protocol";
import { keysOf, type SubscriptionLike } from "./subscription-keys.ts";

export interface ReconcileInput {
  readonly granted: boolean;
  /** Notifications were turned on here: the route to the host is saved. */
  readonly routeSaved: boolean;
  /** The browser's subscription, and whether it was made with the host's current VAPID key; null when it has none. */
  readonly browser: { readonly keyMatches: boolean } | null;
  /** The host holds the browser's endpoint for this device. */
  readonly held: boolean;
}

/**
 * What `load()` does with notifications that were on: keep them, send the host the subscription it lost (`resend`),
 * or subscribe the browser again and send that (`resubscribe`: the browser dropped it, or the host's key changed).
 * Only a withdrawn permission, or notifications never turned on here, makes them off.
 */
export function reconcile(input: ReconcileInput): "off" | "on" | "resend" | "resubscribe" {
  if (!input.granted || !input.routeSaved) return "off";
  if (input.browser === null || !input.browser.keyMatches) return "resubscribe";
  return input.held ? "on" : "resend";
}

type Request = (line: PushClientLine) => Promise<PushHostLine>;

/**
 * A browser that replaced its subscription (`pushsubscriptionchange`): the host drops the old endpoint and takes the
 * new one with the device's preferences, so the device keeps hearing without opening Settings. True when it holds it.
 */
export async function carryOver(
  old: { readonly endpoint: string } | null,
  fresh: SubscriptionLike,
  prefs: PushPrefs,
  request: Request,
): Promise<boolean> {
  if (old !== null && old.endpoint !== fresh.endpoint) await request({ t: "unsubscribe", endpoint: old.endpoint });
  return (await request({ t: "subscribe", subscription: keysOf(fresh), prefs })).t === "ok";
}
