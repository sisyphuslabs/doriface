import { DEFAULT_RELAY_URL } from "@doriface/crypto";
import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { dial, type Dialed } from "../connect/dial.ts";
import { type Output, pipe } from "../connect/pipe.ts";
import { parseTarget } from "../connect/target.ts";
import { defaultStateDir } from "../state/files.ts";
import { loadDeviceKey } from "../state/known-hosts.ts";

export const CONNECT_USAGE = `usage: doriface-host connect <hostId | pairing link | code> [options]

  Pipes stdin and stdout to the host's hc connect, end-to-end encrypted through the relay, like
  \`ssh <box> hc connect\`. A pairing link or code pairs this machine once; after that the hostId is enough:

    hc machine add --via 'doriface-host connect <hostId>' --name <name>

  The host serves its own hc session, so a shell line hc appends (\`--via\` passes one) is ignored. stdin EOF ends
  the session.

  --relay <url>      the relay (default: the one the host was paired through; for a code, ${DEFAULT_RELAY_URL})
  --state-dir <dir>  this machine's device key and paired hosts (default $DORIFACE_HOST_STATE_DIR, else $XDG_STATE_HOME/doriface-host)
  --name <name>      what the host lists this machine as when it pairs (default this machine's hostname)`;

/** hc gives a dial 20 s for the hello reply; failing earlier leaves it a clear reason on stderr. */
const DIAL_TIMEOUT_MS = 15_000;

function stdoutOutput(): Output {
  return {
    write: (bytes) => process.stdout.write(bytes),
    drained: () =>
      process.stdout.writableNeedDrain
        ? new Promise((resolve) => process.stdout.once("drain", () => resolve()))
        : Promise.resolve(),
  };
}

async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} s`)), ms);
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

export async function connectCommand(args: readonly string[], log: (line: string) => void): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: true,
    options: {
      relay: { type: "string" },
      "state-dir": { type: "string" },
      name: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${CONNECT_USAGE}\n`);
    return 0;
  }
  const [given] = positionals;
  if (given === undefined) throw new Error("connect needs a hostId, a pairing link or a pairing code");
  const target = parseTarget(given);
  const stateDir = values["state-dir"] ?? defaultStateDir();
  const options = {
    stateDir,
    device: loadDeviceKey(stateDir),
    relayUrl: values.relay,
    defaultRelayUrl: DEFAULT_RELAY_URL,
    deviceName: values.name ?? hostname(),
    log,
  };
  const dialed: Dialed = await within(dial(target, options), DIAL_TIMEOUT_MS, "reaching the host through the relay");
  const { secure, link, held } = dialed;
  const stop = (): void => secure.close();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.once("SIGHUP", stop);
  process.stdout.once("error", stop);
  const error = await pipe({ secure, held, link, input: Bun.stdin.stream(), output: stdoutOutput() });
  if (error === undefined) return 0;
  log(`the session ended: ${error.message}`);
  return 1;
}
