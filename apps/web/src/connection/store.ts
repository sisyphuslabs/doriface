import type { HcConnection } from "@doriface/client";
import { useSyncExternalStore } from "react";
import { connect } from "./connect.ts";
import { type ConnectionSettings, isConfigured, loadSettings, saveSettings } from "./settings.ts";

export type ConnectionState =
  | { readonly phase: "unconfigured" }
  | { readonly phase: "connecting"; readonly attempt: number }
  | { readonly phase: "open"; readonly connection: HcConnection }
  | { readonly phase: "failed"; readonly error: Error; readonly retryInMs: number | null };

const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

/** Owns the one live connection: connects, reconnects with backoff, and reports its state. */
export class ConnectionStore {
  #settings: ConnectionSettings;
  #state: ConnectionState = { phase: "unconfigured" };
  #listeners = new Set<() => void>();
  #abort: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(settings: ConnectionSettings) {
    this.#settings = settings;
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

  update(settings: ConnectionSettings): void {
    this.#settings = settings;
    saveSettings(settings);
    this.start();
  }

  /** Shows the connecting state while the desktop app restarts its local host before the first attempt. */
  restoring(): void {
    this.stop();
    this.#set({ phase: "connecting", attempt: 0 });
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
    this.#abort?.abort();
    this.#abort = null;
    if (this.#state.phase === "open") this.#state.connection.close();
  }

  async #attempt(attempt: number): Promise<void> {
    const abort = new AbortController();
    this.#abort = abort;
    this.#set({ phase: "connecting", attempt });
    try {
      const connection = await connect(this.#settings, abort.signal);
      if (abort.signal.aborted) return connection.close();
      connection.onClose((error) => {
        if (this.#abort !== abort) return;
        this.#retry(error ?? new Error("the host closed the connection"), 0);
      });
      this.#set({ phase: "open", connection });
    } catch (error) {
      if (abort.signal.aborted) return;
      this.#retry(error instanceof Error ? error : new Error(String(error)), attempt + 1);
    }
  }

  #retry(error: Error, attempt: number): void {
    if (error.name === "EncryptionUnavailableError") {
      this.#set({ phase: "failed", error, retryInMs: null });
      return;
    }
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 10_000;
    this.#set({ phase: "failed", error, retryInMs: delay });
    this.#timer = setTimeout(() => void this.#attempt(attempt), delay);
  }

  #set(state: ConnectionState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}

export const connectionStore = new ConnectionStore(loadSettings());

export function useConnection(store: ConnectionStore = connectionStore): ConnectionState {
  return useSyncExternalStore(store.subscribe, () => store.state);
}
