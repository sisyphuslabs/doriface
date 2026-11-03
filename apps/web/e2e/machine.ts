// A second hc core added to the e2e core with `hc machine add --via`, for captures of a workspace with machines.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const quote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

const agent = (state: string, msg: string, line: string): string[] => [
  "sh",
  "-c",
  `printf '\\033]7501;state=${state}:msg=${btoa(msg)}\\033\\\\'; printf '%s\\n' '${line}'; exec sleep 3600`,
];

export const MACHINE_NAME = "build-box";

/** Starts the second core, seeds two terminals on it and adds it; resolves with its stop. */
export async function addMachine(
  hc: string,
  env: Record<string, string | undefined>,
  root: string,
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
  const there = { ...env, ...own };
  const seeds = [
    { name: "plan", argv: agent("working", "terraform plan", "Refreshing state") },
    { name: "logs", argv: ["env", "PS1=$ ", "sh"] },
  ];
  const cwd = join(root, "infra");
  mkdirSync(cwd, { recursive: true });
  const runs = seeds.map(async ({ name, argv }) => {
    const run = Bun.spawn([hc, "run", "--bg", "--name", name, "--", ...argv], { env: there, cwd, stdout: "ignore" });
    if ((await run.exited) !== 0) throw new Error(`hc run ${name} on the second core failed`);
  });
  await Promise.all(runs);
  const via = ["env", ...Object.entries(own).map(([key, value]) => `${key}=${quote(value)}`), "sh", "-c"].join(" ");
  const add = Bun.spawn([hc, "machine", "add", "--via", via, "--name", MACHINE_NAME], { env, stdout: "ignore" });
  if ((await add.exited) !== 0) throw new Error("hc machine add for the second core failed");
  return async () => {
    const control = Bun.spawn([hc, "connect", "--session", session], { env: there, stdin: "pipe", stdout: "pipe" });
    control.stdin.write('{"jsonrpc":"2.0","id":1,"method":"server.stop"}\n');
    await control.stdin.flush();
    void control.stdin.end();
    await control.exited;
  };
}
