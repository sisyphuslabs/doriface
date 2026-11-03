import packageJson from "../package.json" with { type: "json" };
import { fingerprintOf } from "@doriface/crypto";
import { controlIsLive, listenControl } from "./control.ts";
import { lanUrlsFor } from "./lan-urls.ts";
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
  /** For tests: the direct-path idle close (default 90 s). */
  readonly directIdleMs?: number | undefined;
  /** Registers typed-code pairing slots with the relay (PAIR_SLOT over the host uplink). */
  readonly pairingSlots?: PairingSlotRegistrar | undefined;
  readonly log: (line: string) => void;
}

export interface E2eeEndpoint {
  readonly hostId: string;
  readonly fingerprint: string;
  /** `/v1/e2ee` on the main listener. */
  readonly url: string;
  /** The dialable `/v1/e2ee` URLs of the LAN listener (IP literals, also sent in message 2); empty without one. */
  readonly lanUrls: readonly string[];
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
  if (options.lanListen !== undefined && options.stateDir === undefined) {
    throw new Error("a LAN listener serves only /v1/e2ee, which needs a state dir");
  }
  if (options.stateDir !== undefined && (await controlIsLive(options.stateDir))) {
    throw new Error(`another doriface-host is already running on ${options.stateDir}`);
  }
  const hcVersion = await readHcVersion(options.hc);
  const e2ee = options.stateDir === undefined ? undefined : e2eeDeps(options.stateDir, options);
  const gateway = createGateway({
    e2ee,
    token: options.token,
    hostVersion: HOST_VERSION,
    hcVersion,
    log: options.log,
    directIdleMs: options.directIdleMs,
    openPipe: () => new HcPipe({ hc: options.hc, session: options.session, env: options.env, log: options.log }),
  });
  const server = Bun.serve({ hostname, port, fetch: gateway.app.fetch, websocket: gateway.websocket });
  const lan = options.lanListen;
  let lanServer: ReturnType<typeof Bun.serve> | undefined;
  try {
    lanServer =
      lan === undefined || e2ee === undefined
        ? undefined
        : Bun.serve({
            hostname: lan.hostname,
            port: lan.port,
            fetch: gateway.lanApp.fetch,
            websocket: gateway.websocket,
          });
  } catch (error) {
    await server.stop(true);
    throw error;
  }
  if (lan !== undefined && lanServer !== undefined) {
    e2ee?.lanUrls.push(...lanUrlsFor(lan.hostname, lanServer.port ?? lan.port));
  }
  let control: ReturnType<typeof openControl> | undefined;
  try {
    control = options.stateDir === undefined || e2ee === undefined ? undefined : openControl(options.stateDir, e2ee);
  } catch (error) {
    await Promise.all([server.stop(true), lanServer?.stop(true)]);
    throw new Error(`cannot open the control socket that devices revoke uses: ${String(error)}`, { cause: error });
  }
  e2ee?.slots.start();
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
            lanUrls: e2ee.lanUrls,
          },
    stop() {
      e2ee?.slots.stop();
      control?.stop();
      stopping ??= gateway
        .closeAll()
        .then(() => Promise.all([server.stop(true), lanServer?.stop(true)]))
        .then(() => undefined);
      return stopping;
    },
  };
}

/** The control socket is how `devices revoke` closes live sessions, so a host that cannot open it does not start. */
function openControl(stateDir: string, e2ee: ReturnType<typeof e2eeDeps>) {
  return listenControl(stateDir, async (request) => {
    if (request.op === "devices-changed") return e2ee.sessions.closeRevoked();
    return e2ee.slots.open();
  });
}

function e2eeDeps(stateDir: string, options: HostOptions) {
  const devices = new DeviceStore(stateDir);
  const pairing = new PairingStore(stateDir);
  const identity = loadHostIdentity(stateDir);
  /** Filled in once the LAN listener has its port. */
  const lanUrls: string[] = [];
  return {
    identity,
    lanUrls,
    devices,
    pairing,
    slots: new PairingSlots(pairing, identity.noise.publicKey, options.pairingSlots, options.log),
    sessions: new LiveSessions(devices, options.log),
    rekeyInterval: options.rekeyInterval,
    log: options.log,
  };
}
