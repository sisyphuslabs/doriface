#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { assertValidToken, generateToken } from "./auth.ts";
import { DEVICES_USAGE, devicesCommand } from "./commands/devices.ts";
import { PAIR_USAGE, pairCommand } from "./commands/pair.ts";
import { HOST_VERSION, startHost } from "./host.ts";
import { parseListen } from "./listen.ts";
import { defaultStateDir } from "./state/files.ts";

const USAGE = `usage: doriface-host [options]
       doriface-host pair [options]
       doriface-host devices list|revoke <id>

  --listen <host:port>  where to listen (default 127.0.0.1:7766; loopback only)
  --hc <path>           the herdr-core binary (default hc)
  --session <name>      the hc session to reach (hc connect --session)
  --token <token>       the client token (default $DORIFACE_HOST_TOKEN, else 32 random bytes)
  --print-token         print the token on stdout once listening
  --unsafe-listen       allow a non-loopback --listen (plaintext: anyone who can reach it gets a shell)
  --lan-listen <h:p>    also serve the end-to-end encrypted /v1/e2ee (only) here; any address is fine
  --state-dir <dir>     host keys and paired devices (default $DORIFACE_HOST_STATE_DIR, else $XDG_STATE_HOME/doriface-host)
  -h, --help            show this help`;

const log = (line: string): void => {
  process.stderr.write(`${new Date().toISOString()} ${line}\n`);
};

const out = (text: string): void => {
  process.stdout.write(text);
};

async function main(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "pair") return pairCommand(rest, out);
  if (command === "devices") {
    process.exitCode = devicesCommand(rest, out);
    return;
  }
  return serve(args);
}

async function serve(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      listen: { type: "string", default: "127.0.0.1:7766" },
      hc: { type: "string", default: "hc" },
      session: { type: "string" },
      token: { type: "string" },
      "print-token": { type: "boolean", default: false },
      "unsafe-listen": { type: "boolean", default: false },
      "lan-listen": { type: "string" },
      "state-dir": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const given = values.token ?? process.env["DORIFACE_HOST_TOKEN"] ?? "";
  const token = given === "" ? generateToken() : assertValidToken(given);
  const host = await startHost({
    listen: parseListen(values.listen),
    token,
    hc: values.hc,
    session: values.session,
    unsafeListen: values["unsafe-listen"],
    lanListen: values["lan-listen"] === undefined ? undefined : parseListen(values["lan-listen"]),
    stateDir: values["state-dir"] ?? defaultStateDir(),
    log,
  });
  const session = values.session === undefined ? "" : `, session ${values.session}`;
  log(`doriface-host ${HOST_VERSION} listening on ${host.url} (hc ${host.hcVersion}${session})`);
  const e2ee = host.e2ee;
  if (e2ee !== undefined) {
    const lan = e2ee.lanUrl === undefined ? "" : ` and ${e2ee.lanUrl}`;
    log(`end-to-end encrypted at ${e2ee.url}${lan}; host ${e2ee.hostId}, fingerprint ${e2ee.fingerprint}`);
  }
  if (values["print-token"]) process.stdout.write(`${token}\n`);
  else if (given === "") log("generated a token; pass --print-token to see it");

  const shutdown = (signal: string): void => {
    log(`${signal}: closing all pipes`);
    host.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        log(`shutdown failed: ${String(error)}`);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main(Bun.argv.slice(2)).catch((error: unknown) => {
  const usage = Bun.argv[2] === "pair" ? PAIR_USAGE : Bun.argv[2] === "devices" ? DEVICES_USAGE : USAGE;
  process.stderr.write(`doriface-host: ${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
  process.exit(2);
});
