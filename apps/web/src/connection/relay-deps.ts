import type { StaticKey } from "@doriface/crypto";
import { loadDeviceKey } from "./device-key.ts";

/** What the relay path needs from the browser; tests replace the device key. */
export interface RelayDeps {
  readonly loadDeviceKey: () => Promise<StaticKey>;
}

export const BROWSER_DEPS: RelayDeps = { loadDeviceKey };

/** Loads the device key for a relay socket that is already open, closing the socket if the key cannot load. */
export async function deviceKeyFor(link: { close(): void }, deps: RelayDeps): Promise<StaticKey> {
  try {
    return await deps.loadDeviceKey();
  } catch (error) {
    link.close();
    throw error;
  }
}
