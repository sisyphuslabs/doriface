// Sidebar fixtures on the e2e cores: a space named alike on this machine and on the added one, a long machine
// name, and idle sessions with long titles. Each spec seeds what it needs and removes it afterwards.
import { execFileSync } from "node:child_process";
import { E2E_HOST_ENV } from "./config.ts";
import { MACHINE_NAME } from "./machine.ts";
import { readSavedEnv } from "./saved-env.ts";

/** Long enough to fill the machine column of a sidebar row. */
export const LONG_MACHINE = "build-box-in-the-staging-rack";
export const SHARED_SPACE = "api-gateway";
/** A space named in Korean, whose characters run about twice as wide as Latin ones. */
export const KOREAN_SPACE = "한국어-문서-정리";
export const KOREAN_TITLE = "오모 - 원격 세션 정리 작업";

function hc(args: readonly string[]): string {
  const { hc: bin, env } = readSavedEnv(E2E_HOST_ENV);
  return execFileSync(bin, args, { env: { ...process.env, ...env }, encoding: "utf8" });
}

export interface Seed {
  readonly name: string;
  /** Shown as the row's title: an OSC 0 title the program sets. */
  readonly title: string;
  readonly space: string;
  readonly remote?: true;
}

/** One space name on both machines, and idle sessions whose titles fill their rows. */
export const SEEDS: readonly Seed[] = [
  { name: "sb-quota", title: "OmO - Check sk keys quota status", space: SHARED_SPACE },
  { name: "sb-bench", title: "OmO - Verify bun benchmarks on the box", space: SHARED_SPACE, remote: true },
  { name: "sb-review", title: "linuxuser@build-box: ~/work/review", space: "review", remote: true },
  { name: "sb-notes", title: "OmO - Summarize the release notes", space: "notes" },
  { name: "sb-docs", title: "OmO - Draft the onboarding docs", space: KOREAN_SPACE, remote: true },
  { name: "sb-korean", title: KOREAN_TITLE, space: KOREAN_SPACE, remote: true },
];

/** Starts an idle session that never reports a status and returns its address. */
export function start(seed: Seed, machine: string): string {
  const on = seed.remote === true ? ["--on", machine] : [];
  const script = `printf '\\033]0;%s\\007' '${seed.title}'; exec sleep 3600`;
  // A --name would win over the title in the row, so the seed's name goes into a label instead.
  const labels = ["--label", `space=${seed.space}`, "--label", `seed=${seed.name}`];
  const out = hc(["run", "--bg", "--json", ...on, ...labels, "--", "sh", "-c", script]);
  const started: unknown = JSON.parse(out);
  const address = typeof started === "object" && started !== null ? Reflect.get(started, "address") : undefined;
  if (typeof address !== "string") throw new Error(`hc run ${seed.name} printed no address`);
  return address;
}

/** Ends the sessions a spec started, before the machine gets its usual name back. */
export function stop(addresses: readonly string[]): void {
  for (const address of addresses) hc(["kill", address]);
}

function machineState(name: string): string | undefined {
  const listed: unknown = JSON.parse(hc(["machine", "ls", "--json"]));
  const machines = typeof listed === "object" && listed !== null ? Reflect.get(listed, "machines") : undefined;
  if (!Array.isArray(machines)) throw new Error("hc machine ls printed no machine list");
  const found: unknown = machines.find(
    (machine: unknown) => typeof machine === "object" && machine !== null && Reflect.get(machine, "name") === name,
  );
  const state = typeof found === "object" && found !== null ? Reflect.get(found, "state") : undefined;
  return typeof state === "string" ? state : undefined;
}

/** Waits for hc to report the machine connected: an earlier spec may have dropped its line, and hc redials within 30 s. */
export async function machineConnected(name: string, deadline = Date.now() + 45_000): Promise<void> {
  if (machineState(name) === "connected") return;
  if (Date.now() > deadline) throw new Error(`${name} did not connect within 45 s`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return machineConnected(name, deadline);
}

/** Gives the added machine the long name; the returned function restores the usual one. */
export function renameMachine(): () => void {
  hc(["machine", "rename", MACHINE_NAME, LONG_MACHINE]);
  return () => void hc(["machine", "rename", LONG_MACHINE, MACHINE_NAME]);
}
