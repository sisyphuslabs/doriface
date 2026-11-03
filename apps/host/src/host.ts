import packageJson from "../package.json" with { type: "json" };
import { createGateway } from "./gateway.ts";
import { HcPipe, readHcVersion } from "./hc-pipe.ts";
import { formatHost, isLoopbackHost, type ListenAddress } from "./listen.ts";

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
  readonly log: (line: string) => void;
}

export interface Host {
  /** The WebSocket endpoint, e.g. `ws://127.0.0.1:7766/v1/hc`. */
  readonly url: string;
  readonly port: number;
  readonly hcVersion: string;
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
  const gateway = createGateway({
    token: options.token,
    hostVersion: HOST_VERSION,
    hcVersion,
    log: options.log,
    openPipe: () => new HcPipe({ hc: options.hc, session: options.session, env: options.env, log: options.log }),
  });
  const server = Bun.serve({ hostname, port, fetch: gateway.app.fetch, websocket: gateway.websocket });
  const boundPort = server.port ?? port;
  let stopping: Promise<void> | undefined;
  return {
    url: `ws://${formatHost(hostname)}:${boundPort}/v1/hc`,
    port: boundPort,
    hcVersion,
    stop() {
      stopping ??= gateway.closeAll().then(() => server.stop(true));
      return stopping;
    },
  };
}
