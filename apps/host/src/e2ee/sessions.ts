import { base64urlEncode, type SecureLink } from "@doriface/crypto";
import type { DeviceStore } from "../state/devices.ts";
import { REVOKED } from "./accept.ts";

/** Live E2EE sessions by device key, so a revocation closes them with 4401. */
export class LiveSessions {
  readonly #devices: DeviceStore;
  readonly #byKey = new Map<string, Set<SecureLink>>();
  readonly #log: (line: string) => void;

  constructor(devices: DeviceStore, log: (line: string) => void) {
    this.#devices = devices;
    this.#log = log;
  }

  /** Registers a session, then re-checks the store: a revoke that ran during its handshake still closes it. */
  add(session: SecureLink): void {
    const key = base64urlEncode(session.remoteStatic);
    const sessions = this.#byKey.get(key) ?? new Set();
    sessions.add(session);
    this.#byKey.set(key, sessions);
    session.onClose(() => {
      sessions.delete(session);
      if (sessions.size === 0 && this.#byKey.get(key) === sessions) this.#byKey.delete(key);
    });
    this.closeRevoked();
  }

  /** Closes every session whose device is no longer in the store. */
  closeRevoked(): void {
    let paired: ReadonlySet<string>;
    try {
      paired = new Set(this.#devices.list().map((device) => device.clientStaticPub));
    } catch (error) {
      this.#log(`cannot read the devices file: ${String(error)}`);
      return;
    }
    for (const [key, sessions] of this.#byKey) {
      if (paired.has(key)) continue;
      for (const session of sessions) session.close(REVOKED.code, REVOKED.reason);
    }
  }
}
