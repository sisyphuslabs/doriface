import packageJson from "../package.json" with { type: "json" };
import { fingerprintOf } from "@doriface/crypto";
import { listenControl } from "./control.ts";
import { LiveSessions } from "./e2ee/sessions.ts";
import { createGateway } from "./gateway.ts";
import { HcPipe, readHcVersion } from "./hc-pipe.ts";
import { formatHost, isLoopbackHost, type ListenAddress } from "./listen.ts";
import { type PairingSlotRegistrar, PairingSlots } from "./pairing-slots.ts";
import { DeviceStore } from "./state/devices.ts";
import { loadHostIdentity } from "./state/host-keys.ts";
import { PairingStore } from "./state/pairing.ts";

export const HOST_VERSION = packageJson.version;

export interface HostOptions {
  readonly listen: ListenAddress;
  readonly token: string;
  readonly hc: string;
  readonly session?: string | undefined;
  /** Environment for the `hc connect` children; defaults to this process's. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Allow a non-loopback bind. The endpoint is plaintext, so this exposes the token and the shell. */
  readonly unsafeListen?: boolean | undefined;
  /** Where the host keys, paired devices and pending pairing live; enables `/v1/e2ee`. */
  readonly stateDir?: string | undefined;
  /** A second listener serving only healthz and `/v1/e2ee`; it may bind any address. */
  readonly lanListen?: ListenAddress | undefined;
  /** For tests: messages per direction between rekeys. */
  readonly rekeyInterval?: number | undefined;
  /** Registers typed-code pairing slots with the relay (PAIR_SLOT over the host uplink). */
  readonly pairingSlots?: PairingSlotRegistrar | undefined;
  readonly log: (line: string) => void;
}

export interface E2eeEndpoint {
  readonly hostId: string;
  readonly fingerprint: string;
  /** `/v1/e2ee` on the main listener. */
  readonly url: string;
  /** `/v1/e2ee` on the LAN listener, when one was asked for. */
  readonly lanUrl: string | undefined;
}

export interface Host {
  /** The WebSocket endpoint, e.g. `ws://127.0.0.1:7766/v1/hc`. */
  readonly url: string;
  readonly port: number;
  readonly hcVersion: string;
  readonly e2ee: E2eeEndpoint | undefined;
  /** Closes every client and `hc connect` child, then the listener. */
  stop(): Promise<void>;
}

export async function startHost(options: HostOptions): Promise<Host> {
  const { hostname, port } = options.listen;
  if (!isLoopbackHost(hostname) && options.unsafeListen !== true) {
    throw new Error(
      `refusing to listen on ${hostname}: the endpoint is plaintext; bind loopback or pass --unsafe-listen`,
    );
  }
  const hcVersion = await readHcVersion(options.hc);
  const e2ee = options.stateDir === undefined ? undefined : e2eeDeps(options.stateDir, options);
  const gateway = createGateway({
    e2ee,
    token: options.token,
    hostVersion: HOST_VERSION,
    hcVersion,
    log: options.log,
    openPipe: () => new HcPipe({ hc: options.hc, session: options.session, env: options.env, log: options.log }),
  });
  const server = Bun.serve({ hostname, port, fetch: gateway.app.fetch, websocket: gateway.websocket });
  const lan = options.lanListen;
  const lanServer =
    lan === undefined || e2ee === undefined
      ? undefined
      : Bun.serve({
          hostname: lan.hostname,
          port: lan.port,
          fetch: gateway.lanApp.fetch,
          websocket: gateway.websocket,
        });
  e2ee?.slots.start();
  const control =
    options.stateDir === undefined || e2ee === undefined ? undefined : openControl(options.stateDir, e2ee, options.log);
  const boundPort = server.port ?? port;
  const base = `ws://${formatHost(hostname)}:${boundPort}`;
  let stopping: Promise<void> | undefined;
  return {
    url: `${base}/v1/hc`,
    port: boundPort,
    hcVersion,
    e2ee:
      e2ee === undefined
        ? undefined
        : {
            hostId: e2ee.identity.hostId,
            fingerprint: fingerprintOf(e2ee.identity.noise.publicKey),
            url: `${base}/v1/e2ee`,
            lanUrl:
              lan === undefined ? undefined : `ws://${formatHost(lan.hostname)}:${lanServer?.port ?? lan.port}/v1/e2ee`,
          },
    stop() {
      e2ee?.slots.stop();
      control?.stop(true);
      stopping ??= gateway
        .closeAll()
        .then(() => Promise.all([server.stop(true), lanServer?.stop(true)]))
        .then(() => undefined);
      return stopping;
    },
  };
}

function openControl(stateDir: string, e2ee: ReturnType<typeof e2eeDeps>, log: (line: string) => void) {
  try {
    return listenControl(stateDir, async (request) => {
      if (request.op === "devices-changed") return e2ee.sessions.closeRevoked();
      return e2ee.slots.open();
    });
  } catch (error) {
    log(`no control socket (pair and devices revoke will not reach this host): ${String(error)}`);
    return undefined;
  }
}

function e2eeDeps(stateDir: string, options: HostOptions) {
  const devices = new DeviceStore(stateDir);
  const pairing = new PairingStore(stateDir);
  return {
    identity: loadHostIdentity(stateDir),
    devices,
    pairing,
    slots: new PairingSlots(pairing, options.pairingSlots, options.log),
    sessions: new LiveSessions(devices, options.log),
    rekeyInterval: options.rekeyInterval,
    log: options.log,
  };
}
