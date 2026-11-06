import type { PushClientLine, PushHostLine } from "@doriface/protocol";
import { loadPushRoute, openPushLink, type PushRoute } from "./push-route.ts";
import { PushStreamClient } from "./push-stream-client.ts";

const REOPEN_MS = 5_000;

/**
 * The app's push stream to its host. It stays open only while this device shows a pane focused and visible, so the
 * host holds back notices about that pane; otherwise it opens for a request and closes after it.
 */
export class PushChannel {
  readonly #open: (route: PushRoute) => Promise<PushStreamClient>;
  #client: PushStreamClient | undefined;
  /** The route `#client` was opened on: a request for another host never reuses it. */
  #clientRoute = "";
  #opening: Promise<PushStreamClient> | undefined;
  /** The route the pending open dials, so a request for another route never adopts it. */
  #openingRoute: string | undefined;
  /** Bumped by `reset()`: an open that resolves under an older generation is closed, never adopted (#446 §3). */
  #generation = 0;
  #focus: string | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(open = async (route: PushRoute) => new PushStreamClient(await openPushLink(route))) {
    this.#open = open;
  }

  /**
   * One request on a stream of its own, used and closed: a connection change resets the stream that follows its path
   * (#446 §3), and that reset must never drop a request the page is waiting on, such as the unsubscribe a host this
   * device is leaving needs (#446 §2).
   */
  async requestOnce(line: PushClientLine, route?: PushRoute): Promise<PushHostLine> {
    const reached = route ?? (await loadPushRoute());
    if (reached === undefined) throw new Error("notifications are off on this device");
    const client = await this.#open(reached);
    try {
      return await client.request(line);
    } finally {
      client.close();
    }
  }

  /** The pane this device shows focused and visible, or null; the host hears it while it matters. */
  focus(terminal: string | null): void {
    if (terminal === this.#focus) return;
    this.#focus = terminal;
    clearTimeout(this.#timer);
    if (terminal === null) {
      const client = this.#client;
      if (client !== undefined) this.#drop(client);
      return;
    }
    void this.#present();
  }

  async #present(): Promise<void> {
    const route = await loadPushRoute().catch(() => undefined);
    if (route === undefined || this.#focus === null) return;
    try {
      const client = await this.#connect(route);
      if (this.#focus !== null) client.tell({ t: "focus", terminal: this.#focus });
    } catch {
      this.#timer = setTimeout(() => void this.#present(), REOPEN_MS);
    }
  }

  /** Closes the stream, e.g. when the connection moved to another host; the next request opens a fresh one. */
  reset(): void {
    this.#generation += 1;
    this.#opening = undefined;
    this.#openingRoute = undefined;
    const client = this.#client;
    if (client !== undefined) this.#drop(client);
  }

  #connect(route: PushRoute): Promise<PushStreamClient> {
    const key = JSON.stringify(route);
    const client = this.#client;
    if (client !== undefined && !client.closed && this.#clientRoute === key) return Promise.resolve(client);
    if (client !== undefined) this.#drop(client);
    if (this.#opening !== undefined && this.#openingRoute === key) return this.#opening;
    const generation = this.#generation;
    const started = this.#open(route)
      .then((opened) => {
        if (generation !== this.#generation) {
          opened.close();
          throw new Error("the push stream was reset while it opened");
        }
        this.#client = opened;
        this.#clientRoute = key;
        return opened;
      })
      .finally(() => {
        if (this.#opening === started) {
          this.#opening = undefined;
          this.#openingRoute = undefined;
        }
      });
    this.#opening = started;
    this.#openingRoute = key;
    return started;
  }

  #drop(client: PushStreamClient): void {
    if (this.#client === client) this.#client = undefined;
    client.close();
  }
}

export const pushChannel = new PushChannel();
