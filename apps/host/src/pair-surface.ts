import type { HostIdentity } from "@doriface/crypto";
import { type PairingOfferView, pairingOfferView } from "./pair-offer.ts";
import { type DeviceStore, deviceIdOf, type PairedDevice } from "./state/devices.ts";
import type { PairingStore, PendingPairing } from "./state/pairing.ts";

export interface PairedDeviceView {
  readonly name: string;
  readonly id: string;
  readonly pairedAt: string;
}

/**
 * The state of this host's pairing offer, as a surface shows it: a code to read, the device that used it, or that the
 * offer ran out.
 */
export type PairState =
  | { readonly state: "pending"; readonly offer: PairingOfferView }
  | { readonly state: "paired"; readonly device: PairedDeviceView | null }
  | { readonly state: "expired" }
  | { readonly state: "none" };

export interface PairOffersOptions {
  readonly identity: HostIdentity;
  readonly pairing: PairingStore;
  readonly devices: DeviceStore;
  /** Opens a fresh offer, replacing any pending one (the running host's `pairDevice`). */
  readonly open: () => Promise<PendingPairing>;
  readonly relayUrl: string;
  readonly webOrigin?: string | undefined;
  readonly now?: (() => number) | undefined;
}

/**
 * This host's side of a surface that offers it to a device: it remembers the offer it opened, so a consumed one reads
 * as paired rather than as an offer that simply vanished, and names the device that paired.
 */
export class PairOffers {
  readonly #options: PairOffersOptions;
  #opened: { readonly expiresAt: number; readonly at: number } | undefined;

  constructor(options: PairOffersOptions) {
    this.#options = options;
  }

  async open(): Promise<PairState> {
    const offer = await this.#options.open();
    this.#opened = { expiresAt: offer.expiresAt, at: this.#now() };
    return { state: "pending", offer: this.#view(offer) };
  }

  state(): PairState {
    const now = this.#now();
    const pending = this.#options.pairing.read();
    if (pending !== undefined && now < pending.expiresAt) return { state: "pending", offer: this.#view(pending) };
    const opened = this.#opened;
    if (opened === undefined) return { state: "none" };
    if (pending !== undefined || now >= opened.expiresAt) return { state: "expired" };
    return { state: "paired", device: this.#pairedSince(opened.at) };
  }

  #view(offer: PendingPairing): PairingOfferView {
    const { identity, relayUrl, webOrigin } = this.#options;
    return pairingOfferView({ identity, offer, relayUrl, webOrigin });
  }

  #pairedSince(since: number): PairedDeviceView | null {
    const recent = this.#options.devices.list().filter((device) => pairedAt(device) >= since);
    const device = recent[recent.length - 1];
    return device === undefined ? null : { name: device.name, id: deviceIdOf(device), pairedAt: device.pairedAt };
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}

function pairedAt(device: PairedDevice): number {
  const at = Date.parse(device.pairedAt);
  return Number.isFinite(at) ? at : 0;
}
