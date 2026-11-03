import {
  ed25519Signer,
  generateSigningKey,
  type HostSigner,
  type SessionLink,
  Uplink,
  type UplinkState,
} from "@doriface/relay-client";
import { socketFrom } from "./probe.ts";
import { AsyncQueue } from "./queue.ts";

export interface TestHost {
  readonly uplink: Uplink;
  readonly signer: HostSigner;
  readonly secretKey: Uint8Array;
  readonly sessions: AsyncQueue<SessionLink>;
  readonly states: readonly UplinkState[];
}

export interface TestHostOptions {
  readonly secretKey?: Uint8Array;
  readonly pingIntervalMs?: number;
}

/** Starts an uplink and resolves once it has answered the relay's challenge. */
export async function startTestHost(relayUrl: string, ip: string, options: TestHostOptions = {}): Promise<TestHost> {
  const secretKey = options.secretKey ?? generateSigningKey();
  const signer = ed25519Signer(secretKey);
  const sessions = new AsyncQueue<SessionLink>();
  const states: UplinkState[] = [];
  const answered = Promise.withResolvers<void>();
  const uplink = await Uplink.start({
    relayUrl,
    signer,
    createSocket: socketFrom(ip),
    ...(options.pingIntervalMs === undefined ? {} : { pingIntervalMs: options.pingIntervalMs }),
    onSession: (session) => sessions.push(session),
    onState: (state) => {
      states.push(state);
      if (state.state === "answered") answered.resolve();
      if (state.state === "stopped") answered.reject(new Error(`uplink stopped with ${state.code}`));
    },
  });
  await answered.promise;
  return { uplink, signer, secretKey, sessions, states };
}
