import type { HcTarget } from "../mesh/hc-machines.ts";
import type { DeviceStore } from "../state/devices.ts";
import { type CoreFeed, startCoreFeed } from "./core-feed.ts";
import { PushService } from "./push-service.ts";
import { type PushLink, servePushStream } from "./push-stream.ts";
import { SubscriptionStore } from "./subscriptions.ts";
import { loadVapidKey } from "./vapid-key.ts";

export interface HostPush {
  /** Serves one device's push stream: the E2EE session's, or the loopback `/v1/push` socket's. */
  serve(link: PushLink, owner: string): void;
  /** Drops the subscriptions of devices no longer paired (a revoke). */
  prune(): void;
  stop(): void;
}

export interface HostPushOptions {
  readonly stateDir: string;
  readonly hostId: string;
  readonly devices: DeviceStore;
  readonly hc: HcTarget;
  readonly extraOrigins?: readonly string[] | undefined;
  readonly log: (line: string) => void;
}

/**
 * The host's web push: the VAPID key, the subscriptions, and a line to this host's core that starts with the first
 * subscription, so a host nobody subscribed to starts no extra `hc connect`.
 */
export async function startHostPush(options: HostPushOptions): Promise<HostPush> {
  const { stateDir, devices, log } = options;
  const subscriptions = new SubscriptionStore(stateDir);
  const paired = (): ReadonlySet<string> => new Set(devices.list().map((device) => device.clientStaticPub));
  const service = new PushService({
    hostId: options.hostId,
    vapid: await loadVapidKey(stateDir),
    subscriptions,
    paired,
    extraOrigins: options.extraOrigins,
    onSubscribe: () => follow(),
    log,
  });
  let feed: CoreFeed | undefined;
  /** Follows the core from the first subscription on; resolves once the feed has its baseline. */
  function follow(): Promise<void> {
    if (feed === undefined && subscriptions.list().length > 0) feed = startCoreFeed(options.hc, service, log);
    return feed?.ready ?? Promise.resolve();
  }
  const prune = (): void => {
    try {
      subscriptions.keepOwners(paired());
    } catch (error) {
      log(`push: cannot prune the subscriptions: ${String(error)}`);
    }
  };
  prune();
  void follow();
  return {
    serve: (link, owner) => servePushStream(link, owner, service),
    prune,
    stop() {
      feed?.stop();
    },
  };
}
