/// <reference lib="webworker" />
import { base64urlDecode } from "@doriface/crypto";
import { DEFAULT_PUSH_PREFS, parsePushNotice, type PromptAnswer, type PushHostLine } from "@doriface/protocol";
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { planClick } from "./push/notice-click.ts";
import { noticeDisplay } from "./push/notice-display.ts";
import { loadPushPrefs, loadPushRoute, openPushLink } from "./push/push-route.ts";
import { carryOver } from "./push/reconcile.ts";
import { asSubscription } from "./push/subscription-keys.ts";
import { PushStreamClient } from "./push/push-stream-client.ts";

declare const self: ServiceWorkerGlobalScope & {
  readonly __WB_MANIFEST: (string | { readonly url: string; readonly revision: string | null })[];
};

// What the generated worker did before: precache the build, serve index.html for navigations, take over at once.
// oxlint-disable-next-line no-underscore-dangle -- injectManifest replaces this exact name with the precache list
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));
void self.skipWaiting();
clientsClaim();

/** How long an Allow or Deny waits for the host before it opens the pane instead. */
const ANSWER_TIMEOUT_MS = 15_000;

function readPayload(event: PushEvent): unknown {
  try {
    return event.data?.json();
  } catch {
    return undefined;
  }
}

self.addEventListener("push", (event) => {
  const notice = parsePushNotice(readPayload(event));
  // Every push shows a notification: a browser that sees pushes without one revokes or replaces the subscription.
  if (notice === undefined) {
    event.waitUntil(self.registration.showNotification("doriface", { body: "Open doriface to see what changed." }));
    return;
  }
  const { title, ...shown } = noticeDisplay(notice);
  // TypeScript's NotificationOptions lacks `actions`, which Chromium and Firefox show.
  const options: NotificationOptions & Pick<typeof shown, "actions"> = { ...shown, icon: "/icon-192.png" };
  event.waitUntil(self.registration.showNotification(title, options));
});

/** Answers over a fresh E2EE push session: the host checks the live prompt first and types only if it is unchanged. */
async function answerOverPush(id: string, answer: PromptAnswer): Promise<PushHostLine> {
  const route = await loadPushRoute();
  if (route === undefined) throw new Error("notifications are off on this device");
  const client = new PushStreamClient(await openPushLink(route));
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("the host did not answer")), ANSWER_TIMEOUT_MS),
  );
  try {
    return await Promise.race([client.request({ t: "answer", id, answer }), timeout]);
  } finally {
    client.close();
  }
}

/**
 * The browser replaced or dropped this device's subscription (expiry, rotation): the host drops the old endpoint and
 * takes the new one with the same preferences, so notices keep coming without opening Settings.
 */
async function carryOverHere(old: unknown, fresh: unknown): Promise<void> {
  const route = await loadPushRoute();
  if (route === undefined) return;
  const client = new PushStreamClient(await openPushLink(route));
  try {
    const ready = await client.request({ t: "hello" });
    if (ready.t !== "ready") return;
    const next =
      asSubscription(fresh) ??
      asSubscription(
        await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: new Uint8Array(base64urlDecode(ready.vapidKey)),
        }),
      );
    if (next === null) return;
    const prefs = (await loadPushPrefs()) ?? DEFAULT_PUSH_PREFS;
    await carryOver(asSubscription(old), next, prefs, (line) => client.request(line));
  } finally {
    client.close();
  }
}

self.addEventListener("pushsubscriptionchange", (event: Event) => {
  if (!(event instanceof ExtendableEvent)) return;
  event.waitUntil(carryOverHere(Reflect.get(event, "oldSubscription"), Reflect.get(event, "newSubscription")));
});

/** Focuses an open window and hands it the notice, or opens one at the notice's address. */
async function openApp(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows[0];
  if (open === undefined) {
    await self.clients.openWindow(url);
    return;
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's Client.postMessage takes no origin
  open.postMessage({ type: "doriface-notice", url });
  // Posted first: the window opens the pane even where the browser refuses to bring it to the front.
  await open.focus().catch(() => undefined);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    planClick(event.action, event.notification.data, answerOverPush).then((plan) =>
      plan.open === null ? undefined : openApp(plan.open),
    ),
  );
});
