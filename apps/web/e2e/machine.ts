// A second hc core added to the e2e core with `hc machine add --via`. Its dial reads a switch file, so a spec can turn
// the machine off (the dial fails) or make it ask for a login (the dial prints ssh's refusal) with the page open.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { E2E_MACHINE_DIR } from "./config.ts";

export const MACHINE_NAME = "build-box";
/** Holds `off` or `login`; absent means the machine answers. */
export const MACHINE_SWITCH = join(E2E_MACHINE_DIR, "switch");
/** The second core's environment, so a spec can stop that core. */
export const MACHINE_ENV = join(E2E_MACHINE_DIR, "env.json");

const agent = (state: string, msg: string, line: string): string[] => [
  "sh",
  "-c",
  `printf '\\033]7501;state=${state}:msg=${btoa(msg)}\\033\\\\'; printf '%s\\n' '${line}'; exec sleep 3600`,
];

/** The `--via` command: refuses as the switch says, else runs hc's line against the second core. */
function viaCommand(own: Readonly<Record<string, string>>): string {
  const env = Object.entries(own)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  const refusals = [
    `m=$(cat "${MACHINE_SWITCH}" 2>/dev/null)`,
    `[ "$m" = off ] && { echo "build-box is switched off" >&2; exit 1; }`,
    `[ "$m" = login ] && { echo "Permission denied (publickey,password)." >&2; exit 255; }`,
  ];
  return `sh -c '${refusals.join("; ")}; exec env ${env} sh -c "$1"' sh`;
}

async function seed(hc: string, env: Readonly<Record<string, string | undefined>>, root: string): Promise<void> {
  const cwd = join(root, "infra");
  mkdirSync(cwd, { recursive: true });
  const seeds = [
    { name: "plan", argv: agent("working", "terraform plan", "Refreshing state") },
    { name: "logs", argv: ["env", "PS1=$ ", "sh"] },
  ];
  const runs = seeds.map(async ({ name, argv }) => {
    const run = Bun.spawn([hc, "run", "--bg", "--name", name, "--", ...argv], { env, cwd, stdout: "ignore" });
    if ((await run.exited) !== 0) throw new Error(`hc run ${name} on the second core failed`);
  });
  await Promise.all(runs);
}

/** Starts the second core (with demo terminals when `withSeeds`) and adds it; resolves with its stop. */
export async function addMachine(
  hc: string,
  env: Record<string, string | undefined>,
  root: string,
  withSeeds: boolean,
): Promise<() => Promise<void>> {
  const session = `web-e2e-b-${crypto.randomUUID().slice(0, 8)}`;
  const own = {
    HC_SESSION: session,
    XDG_STATE_HOME: join(root, "state"),
    XDG_RUNTIME_DIR: join(root, "run"),
    HC_SOCKET: join(root, "c.sock"),
    PATH: `${dirname(hc)}:${env["PATH"] ?? "/usr/bin:/bin"}`,
  };
  const coreDir = join(own.XDG_STATE_HOME, "herdr-core", session);
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(
    join(coreDir, "core.json"),
    JSON.stringify({ id: crypto.randomUUID().replace(/-/g, ""), name: "build" }),
  );
  rmSync(E2E_MACHINE_DIR, { recursive: true, force: true });
  mkdirSync(E2E_MACHINE_DIR, { recursive: true });
  const there = { ...env, ...own };
  const stop = async (): Promise<void> => {
    rmSync(E2E_MACHINE_DIR, { recursive: true, force: true });
    const control = Bun.spawn([hc, "connect", "--session", session], { env: there, stdin: "pipe", stdout: "pipe" });
    control.stdin.write('{"jsonrpc":"2.0","id":1,"method":"server.stop"}\n');
    await control.stdin.flush();
    void control.stdin.end();
    await control.exited;
  };
  try {
    writeFileSync(MACHINE_ENV, JSON.stringify({ hc, env: own }));
    if (withSeeds) await seed(hc, there, root);
    const add = Bun.spawn([hc, "machine", "add", "--via", viaCommand(own), "--name", MACHINE_NAME], {
      env,
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await add.exited) !== 0) {
      throw new Error(`hc machine add for the second core failed: ${await new Response(add.stderr).text()}`);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}
