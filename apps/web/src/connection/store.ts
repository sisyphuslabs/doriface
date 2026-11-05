import type { HcConnection } from "@doriface/client";
import { useSyncExternalStore } from "react";
import type { HostStartFailure } from "../desktop/bridge.ts";
import { connect, DeviceNotPairedError } from "./connect.ts";
import { LoopbackAddressError } from "./loopback-address.ts";
import { type ConnectionSettings, isConfigured, loadSettings, lockRelay, saveSettings } from "./settings.ts";

/**
 * `stale` is the connection that dropped while this one retries: its workspace stays on screen meanwhile.
 * It is null on the first connect, after a settings change and when retrying cannot help.
 */
export type ConnectionState =
  | { readonly phase: "unconfigured" }
  | { readonly phase: "connecting"; readonly attempt: number; readonly stale: HcConnection | null }
  | { readonly phase: "open"; readonly connection: HcConnection }
  /** This computer's host did not start: nothing is tried until a start succeeds. */
  | { readonly phase: "host-failed"; readonly failure: HostStartFailure }
  | {
      readonly phase: "failed";
      readonly error: Error;
      readonly retryInMs: number | null;
      /** When the next attempt starts (Date.now() epoch ms), or null with retryInMs. */
      readonly retryAt: number | null;
      readonly stale: HcConnection | null;
    };

const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

/** This computer's host, as the desktop app runs it: where it listens now, and why it did not start. */
export interface LocalHostStarter {
  start(): Promise<{ readonly url: string; readonly token: string }>;
  failure(cause: unknown): HostStartFailure;
}

/** Owns the one live connection: connects, reconnects with backoff, and reports its state. */
export class ConnectionStore {
  #settings: ConnectionSettings;
  #state: ConnectionState = { phase: "unconfigured" };
  #listeners = new Set<() => void>();
  #abort: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stale: HcConnection | null = null;
  /** The attempt the pending retry timer will make, so `retryNow` can make it at once. */
  #pending: number | null = null;
  /** Asked before each retry of a loopback link: this computer's host, started again if it died (the desktop app). */
  #localHost: LocalHostStarter | null = null;
  readonly #connect: typeof connect;

  constructor(settings: ConnectionSettings, open: typeof connect = connect) {
    this.#settings = lockRelay(settings);
    this.#connect = open;
  }

  get settings(): ConnectionSettings {
    return this.#settings;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Saves and connects with `settings`; a release build keeps the production relay whatever relay they name. */
  update(settings: ConnectionSettings): void {
    this.#settings = lockRelay(settings);
    saveSettings(this.#settings);
    this.start();
  }

  /** Shows the connecting state while the desktop app restarts its local host before the first attempt. */
  restoring(): void {
    this.stop();
    this.#set({ phase: "connecting", attempt: 0, stale: null });
  }

  /**
   * In the desktop app a loopback link is to this computer's own host. When that link fails and is tried again, the
   * host is asked for first: it answers at once while it runs, and starts again (on a new port, with a new token) if
   * it died, so the retry reaches a host that is there instead of the one that is gone (#515).
   */
  restartsLocalHost(starter: LocalHostStarter): void {
    this.#localHost = starter;
  }

  /** The desktop app's local host did not start at boot: its cause is shown and the saved link is not tried. */
  hostStartFailed(failure: HostStartFailure): void {
    this.stop();
    this.#set({ phase: "host-failed", failure });
  }

  start(): void {
    this.stop();
    if (!isConfigured(this.#settings)) {
      this.#set({ phase: "unconfigured" });
      return;
    }
    void this.#attempt(0);
  }

  stop(): void {
    clearTimeout(this.#timer);
    this.#pending = null;
    this.#abort?.abort();
    this.#abort = null;
    this.#stale = null;
    if (this.#state.phase === "open") this.#state.connection.close();
  }

  async #attempt(attempt: number): Promise<void> {
    const abort = new AbortController();
    this.#abort = abort;
    this.#set({ phase: "connecting", attempt, stale: this.#stale });
    try {
      const connection = await this.#connect(this.#settings, abort.signal);
      if (abort.signal.aborted) return connection.close();
      connection.onClose((error) => {
        if (this.#abort !== abort) return;
        this.#stale = connection;
        this.#retry(error ?? new Error("the host closed the connection"), 0);
      });
      this.#stale = null;
      this.#set({ phase: "open", connection });
    } catch (error) {
      if (abort.signal.aborted) return;
      this.#retry(error instanceof Error ? error : new Error(String(error)), attempt + 1);
    }
  }

  #retry(error: Error, attempt: number): void {
    if (error instanceof DeviceNotPairedError || error instanceof LoopbackAddressError) {
      this.#stale = null;
      this.#set({ phase: "failed", error, retryInMs: null, retryAt: null, stale: null });
      return;
    }
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 10_000;
    this.#set({ phase: "failed", error, retryInMs: delay, retryAt: Date.now() + delay, stale: this.#stale });
    this.#pending = attempt;
    this.#timer = setTimeout(() => {
      this.#pending = null;
      void this.#again(attempt);
    }, delay);
  }

  /** A retry: for a loopback link in the desktop app, this computer's host first, then the link to where it is now. */
  async #again(attempt: number): Promise<void> {
    const starter = this.#localHost;
    if (starter === null || this.#settings.mode !== "loopback") return this.#attempt(attempt);
    const asked = this.#settings;
    const abort = new AbortController();
    this.#abort = abort;
    this.#set({ phase: "connecting", attempt, stale: this.#stale });
    let where: { readonly url: string; readonly token: string };
    try {
      where = await starter.start();
    } catch (cause) {
      if (abort.signal.aborted || this.#settings !== asked) return undefined;
      this.#stale = null;
      return this.#set({ phase: "host-failed", failure: starter.failure(cause) });
    }
    if (abort.signal.aborted || this.#settings !== asked) return undefined;
    if (where.url !== asked.loopbackUrl || where.token !== asked.token) {
      this.#settings = { ...asked, loopbackUrl: where.url, token: where.token };
      saveSettings(this.#settings);
    }
    return this.#attempt(attempt);
  }

  /** Makes a waiting retry now instead of at the end of its back-off (the network is back); the workspace stays. */
  retryNow(): void {
    const attempt = this.#pending;
    if (attempt === null || this.#state.phase !== "failed") return;
    clearTimeout(this.#timer);
    this.#pending = null;
    void this.#again(attempt);
  }

  #set(state: ConnectionState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}

export const connectionStore = new ConnectionStore(loadSettings());

// The network is back: a reconnect waiting out its back-off starts at once.
if (typeof addEventListener === "function") addEventListener("online", () => connectionStore.retryNow());

export function useConnection(store: ConnectionStore = connectionStore): ConnectionState {
  return useSyncExternalStore(store.subscribe, () => store.state);
}
