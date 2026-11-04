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
  #focus: string | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(open = async (route: PushRoute) => new PushStreamClient(await openPushLink(route))) {
    this.#open = open;
  }

  /** One request; `route` defaults to the one saved when notifications were turned on. */
  async request(line: PushClientLine, route?: PushRoute): Promise<PushHostLine> {
    const reached = route ?? (await loadPushRoute());
    if (reached === undefined) throw new Error("notifications are off on this device");
    const client = await this.#connect(reached);
    try {
      return await client.request(line);
    } finally {
      if (this.#focus === null) this.#drop(client);
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
    const client = this.#client;
    if (client !== undefined) this.#drop(client);
  }

  #connect(route: PushRoute): Promise<PushStreamClient> {
    const key = JSON.stringify(route);
    const client = this.#client;
    if (client !== undefined && !client.closed && this.#clientRoute === key) return Promise.resolve(client);
    if (client !== undefined) this.#drop(client);
    this.#opening ??= this.#open(route)
      .then((opened) => {
        this.#client = opened;
        this.#clientRoute = key;
        return opened;
      })
      .finally(() => {
        this.#opening = undefined;
      });
    return this.#opening;
  }

  #drop(client: PushStreamClient): void {
    if (this.#client === client) this.#client = undefined;
    client.close();
  }
}

export const pushChannel = new PushChannel();
