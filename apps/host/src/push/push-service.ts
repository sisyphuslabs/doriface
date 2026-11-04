import {
  answerKeys,
  checkPrompt,
  type HcEvent,
  type HeldSubscription,
  markPrompt,
  noticeMachineId,
  type NoticeKind,
  type PromptAnswer,
  type PromptMark,
  type PushHostLine,
  type PushNotice,
  type PushPrefs,
  type PushSubscriptionKeys,
  type Terminal,
} from "@doriface/protocol";
import { deliverPush, type PushFetch, pushEndpointAllowed } from "./deliver.ts";
import { type NoticeEntry, NoticeBook } from "./notices.ts";
import { LOOPBACK_OWNER, type StoredSubscription, type SubscriptionStore } from "./subscriptions.ts";
import { NoticeTrigger, type Trigger } from "./trigger.ts";
import type { VapidKey } from "./web-push.ts";

/** The host's own hc line, as the push service reads and answers terminals through it. */
export interface PushCore {
  terminal(address: string): Promise<Terminal>;
  /** The visible screen as {@link screenText} gives it. */
  screen(address: string): Promise<string>;
  keys(address: string, keys: readonly string[]): Promise<void>;
}

export interface PushServiceOptions {
  readonly hostId: string;
  readonly vapid: VapidKey;
  readonly subscriptions: SubscriptionStore;
  /** The paired devices' keys, read when a notice goes out, so a device revoked by another process gets none. */
  readonly paired: () => ReadonlySet<string>;
  readonly post?: PushFetch | undefined;
  /** For tests: origins of a private push service the host may also post to. */
  readonly extraOrigins?: readonly string[] | undefined;
  /** Runs after a subscription is stored; its reply waits for it, so `ok` means the host watches the agents. */
  readonly onSubscribe?: (() => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
  readonly log: (line: string) => void;
}

/** A device's open push stream: what it shows focused, until the stream closes. */
export interface Presence {
  focus(terminal: string | null): void;
  leave(): void;
}

async function screenHash(screen: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(screen));
  return Buffer.from(digest).toString("base64url");
}

/**
 * Web push notices (#193): turns hc's status events into notices for the subscribed devices, posts each straight to
 * its push service, and answers a permission notice only after the prompt is checked against the live terminal.
 */
export class PushService {
  readonly #options: PushServiceOptions;
  readonly #trigger = new NoticeTrigger();
  readonly #notices = new NoticeBook();
  readonly #focus = new Map<string, Map<symbol, string | null>>();
  #core: PushCore | undefined;

  constructor(options: PushServiceOptions) {
    this.#options = options;
  }

  get vapidKey(): string {
    return this.#options.vapid.publicKey;
  }

  /** The line to this host's core; undefined while it is down, when an answer is stale. */
  attach(core: PushCore | undefined): void {
    this.#core = core;
  }

  baseline(terminals: readonly Terminal[]): void {
    this.#trigger.baseline(terminals);
  }

  async event(event: HcEvent): Promise<void> {
    const hit = this.#trigger.event(event, this.#now());
    if (hit !== undefined) await this.#notify(hit);
  }

  presence(owner: string): Presence {
    const key = Symbol(owner);
    const streams = this.#focus.get(owner) ?? new Map<symbol, string | null>();
    this.#focus.set(owner, streams);
    streams.set(key, null);
    return {
      focus: (terminal) => streams.set(key, terminal),
      leave: () => {
        streams.delete(key);
        if (streams.size === 0 && this.#focus.get(owner) === streams) this.#focus.delete(owner);
      },
    };
  }

  held(owner: string): readonly HeldSubscription[] {
    return this.#options.subscriptions.ofOwner(owner).map(({ endpoint, prefs }) => ({ endpoint, prefs }));
  }

  /** False when the endpoint is no push service this host posts to. */
  async subscribe(owner: string, keys: PushSubscriptionKeys, prefs: PushPrefs): Promise<boolean> {
    if (!pushEndpointAllowed(keys.endpoint, this.#options.extraOrigins)) return false;
    this.#options.subscriptions.put(owner, keys, prefs);
    await this.#options.onSubscribe?.();
    return true;
  }

  setPrefs(owner: string, endpoint: string, prefs: PushPrefs): boolean {
    return this.#options.subscriptions.setPrefs(owner, endpoint, prefs);
  }

  unsubscribe(owner: string, endpoint: string): void {
    this.#options.subscriptions.remove(owner, endpoint);
  }

  /** Sends one `test` notice to the device's own endpoint; false when it holds no such subscription. */
  async test(owner: string, endpoint: string): Promise<boolean> {
    const subscription = this.#options.subscriptions.ofOwner(owner).find((entry) => entry.endpoint === endpoint);
    if (subscription === undefined) return false;
    const id = this.#notices.add({ terminal: null, kind: "test", at: this.#now(), mark: undefined });
    await this.#send(subscription, this.#notice(id, "test"));
    return true;
  }

  resolve(id: string): NoticeEntry | undefined {
    return this.#notices.get(id, this.#now());
  }

  /**
   * Answers a permission notice with the agent's own keys, once, and only while the prompt it was made for is still the
   * one on the live screen (the shared rule in `checkPrompt`). Anything else is `stale` and sends nothing.
   */
  async answer(id: string, answer: PromptAnswer): Promise<PushHostLine> {
    const entry = this.resolve(id);
    const stale: PushHostLine = { t: "stale", terminal: entry?.terminal ?? null };
    const { terminal, mark } = entry ?? {};
    const core = this.#core;
    if (entry?.kind !== "permission" || terminal == null || mark === undefined || core === undefined) return stale;
    if (!this.#notices.claimAnswer(id)) return stale;
    const keys = answerKeys(mark.app, answer);
    if (keys === undefined) return stale;
    try {
      const [now, screen] = await Promise.all([core.terminal(terminal), core.screen(terminal)]);
      if (checkPrompt(mark, now, await screenHash(screen)) !== "pending") return stale;
      await core.keys(terminal, keys);
    } catch (error) {
      this.#options.log(`push: could not answer a permission notice: ${String(error)}`);
      return stale;
    }
    return { t: "answered", terminal };
  }

  async #notify(hit: Trigger): Promise<void> {
    const machine = noticeMachineId(hit.machine);
    const paired = this.#options.paired();
    const recipients = this.#options.subscriptions
      .list()
      .filter(
        (entry) =>
          (entry.owner === LOOPBACK_OWNER || paired.has(entry.owner)) &&
          entry.prefs.events[hit.kind] &&
          !entry.prefs.muted.includes(machine) &&
          !this.#focused(entry.owner, hit.terminal) &&
          pushEndpointAllowed(entry.endpoint, this.#options.extraOrigins),
      );
    if (recipients.length === 0) return;
    const mark = hit.kind === "permission" ? await this.#mark(hit.terminal) : undefined;
    const id = this.#notices.add({ terminal: hit.terminal, kind: hit.kind, at: this.#now(), mark });
    await Promise.all(recipients.map((entry) => this.#send(entry, this.#notice(id, hit.kind))));
  }

  async #mark(terminal: string): Promise<PromptMark | undefined> {
    const core = this.#core;
    if (core === undefined) return undefined;
    try {
      const [now, screen] = await Promise.all([core.terminal(terminal), core.screen(terminal)]);
      return markPrompt(now, await screenHash(screen));
    } catch (error) {
      this.#options.log(`push: could not read the prompt of ${terminal}: ${String(error)}`);
      return undefined;
    }
  }

  #focused(owner: string, terminal: string): boolean {
    return [...(this.#focus.get(owner)?.values() ?? [])].includes(terminal);
  }

  #notice(id: string, kind: NoticeKind): PushNotice {
    return { v: 1, n: id, k: kind, h: this.#options.hostId };
  }

  async #send(subscription: StoredSubscription, notice: PushNotice): Promise<void> {
    try {
      const delivery = await deliverPush(subscription, notice, this.#options.vapid, this.#options.post);
      if (delivery === "gone") this.#options.subscriptions.removeEndpoint(subscription.endpoint);
      if (delivery === "failed")
        this.#options.log(`push: the push service refused a notice (${new URL(subscription.endpoint).host})`);
    } catch (error) {
      this.#options.log(`push: could not post a notice (${new URL(subscription.endpoint).host}): ${String(error)}`);
    }
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }
}
