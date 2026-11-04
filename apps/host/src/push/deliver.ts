import type { PushNotice, PushSubscriptionKeys } from "@doriface/protocol";
import { encryptPushPayload, type VapidKey, vapidAuthorization } from "./web-push.ts";

/**
 * The push services browsers subscribe with: Chrome and Edge (FCM), Firefox (autopush), Safari (Apple), Edge on Windows
 * (WNS). The host posts only to these over https, so a paired device cannot point it at another server.
 */
const PUSH_SERVICES = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

/**
 * `extraOrigins` is for tests: a private push service the host may also post to (`--push-test-origin`). Port 0
 * stands for any port on that scheme and host, so a test service can bind a free port of its own.
 */
export function pushEndpointAllowed(endpoint: string, extraOrigins: readonly string[] = []): boolean {
  if (!URL.canParse(endpoint)) return false;
  const url = new URL(endpoint);
  if (extraOrigins.some((origin) => sameTestOrigin(origin, url))) return true;
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  return PUSH_SERVICES.some((service) => url.hostname === service || url.hostname.endsWith(`.${service}`));
}

function sameTestOrigin(origin: string, url: URL): boolean {
  if (!URL.canParse(origin)) return false;
  const allowed = new URL(origin);
  if (allowed.protocol !== url.protocol || allowed.hostname !== url.hostname) return false;
  return allowed.port === "0" || allowed.port === url.port;
}

export type Delivery = "sent" | "gone" | "failed";

const TTL_SECONDS = 24 * 60 * 60;
/** Every notice's record, padded: the longest notice is under 100 bytes, so no kind can be told by its length. */
export const NOTICE_RECORD_BYTES = 128;
const TIMEOUT_MS = 10_000;

export type PushFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Encrypts the notice for one subscription and posts it to the subscription's push service. */
export async function deliverPush(
  subscription: PushSubscriptionKeys,
  notice: PushNotice,
  vapid: VapidKey,
  post: PushFetch = fetch,
): Promise<Delivery> {
  const plaintext = new TextEncoder().encode(JSON.stringify(notice));
  if (plaintext.byteLength >= NOTICE_RECORD_BYTES) throw new Error("a notice longer than its padded record");
  const body = await encryptPushPayload(plaintext, subscription, { padTo: NOTICE_RECORD_BYTES });
  const response = await post(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(subscription.endpoint, vapid),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(TTL_SECONDS),
      urgency: "high",
    },
    body: new Uint8Array(body),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) return "gone";
  return response.ok ? "sent" : "failed";
}
