/**
 * The relay is a separate private service, github.com/sisyphuslabs/doriface-relay; its public contract is
 * docs/transport.md. The suites in this directory run this repository's host and client against it, at the commit
 * `relay-pin.json` names, from a checkout this module keeps:
 *
 *   bun run relay:fetch   clone or move `.relay` to the pinned commit and install it
 *   bun run relay:test    fetch, then run the relay suites
 *   bun run relay:dev     fetch, then serve the relay locally with wrangler dev
 *
 * `DORIFACE_RELAY_REPO` overrides the clone URL (default HTTPS with your git credentials; CI passes an SSH URL).
 * `DORIFACE_RELAY_DIR` points at a relay checkout of your own instead, which is used as it is and never moved.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const MANAGED_DIR = join(REPO_ROOT, ".relay");

interface RelayPin {
  readonly repository: string;
  readonly rev: string;
}

/** The relay checkout the suites and `relay:dev` use. */
export const relayDir = (): string => process.env["DORIFACE_RELAY_DIR"] ?? MANAGED_DIR;

class RelayUnreachable extends Error {}

async function readPin(): Promise<RelayPin> {
  const pin: unknown = await Bun.file(join(REPO_ROOT, "relay-pin.json")).json();
  if (
    typeof pin !== "object" ||
    pin === null ||
    !("repository" in pin) ||
    !("rev" in pin) ||
    typeof pin.repository !== "string" ||
    typeof pin.rev !== "string" ||
    !/^[0-9a-f]{40}$/.test(pin.rev)
  ) {
    throw new Error("relay-pin.json must be {repository, rev} with rev a full commit id");
  }
  return { repository: pin.repository, rev: pin.rev };
}

/** Runs `argv` in `cwd` with stdout passed through; stderr is returned as well as printed. */
async function run(argv: readonly string[], cwd: string): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn([...argv], {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "pipe",
    // A credential prompt would hang CI and confuse a developer without access; fail instead.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const stderr = await new Response(proc.stderr).text();
  process.stderr.write(stderr);
  return { code: await proc.exited, stderr };
}

async function must(argv: readonly string[], cwd: string): Promise<void> {
  const { code } = await run(argv, cwd);
  if (code !== 0) throw new Error(`${argv.join(" ")} exited ${code} in ${cwd}`);
}

async function headOf(dir: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", "HEAD"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "ignore",
  });
  const head = (await new Response(proc.stdout).text()).trim();
  return (await proc.exited) === 0 ? head : undefined;
}

/** Brings the managed checkout to the pinned commit and installs it; returns the relay directory to use. */
export async function fetchRelay(): Promise<string> {
  const dir = relayDir();
  if (dir !== MANAGED_DIR) {
    console.log(`relay: using DORIFACE_RELAY_DIR=${dir} as it is`);
    return dir;
  }
  const pin = await readPin();
  const url = process.env["DORIFACE_RELAY_REPO"] ?? `https://github.com/${pin.repository}.git`;
  if (!existsSync(join(dir, ".git"))) {
    await mkdir(dir, { recursive: true });
    await must(["git", "init", "--quiet"], dir);
  }
  if ((await headOf(dir)) !== pin.rev) {
    const fetched = await run(["git", "fetch", "--quiet", "--depth", "1", url, pin.rev], dir);
    if (fetched.code !== 0) throw new RelayUnreachable(`${pin.repository} at ${pin.rev} from ${url}`);
    await must(["git", "checkout", "--quiet", "--detach", "--force", "FETCH_HEAD"], dir);
  }
  // The checkout is this module's own: discard what `bun install` changes inside the submodule (it marks the vendored
  // host CLI executable), or moving to a new pin would refuse to switch the submodule.
  await must(["git", "submodule", "update", "--init", "--depth", "1", "--force"], dir);
  await must([process.execPath, "install", "--frozen-lockfile"], dir);
  console.log(`relay: ${pin.repository} at ${pin.rev} in ${dir}`);
  return dir;
}

async function main(command: string | undefined, rest: readonly string[]): Promise<number> {
  if (command !== "fetch" && command !== "test" && command !== "dev") {
    console.error("usage: bun tests/relay/private-relay.ts fetch|test|dev [args]");
    return 2;
  }
  const dir = await fetchRelay();
  if (command === "fetch") return 0;
  const argv =
    command === "test"
      ? // bunfig.toml keeps tests/relay out of a plain `bun test`; a pattern given here replaces that list.
        [process.execPath, "test", "--path-ignore-patterns", ".relay/**", "./tests/relay", ...rest]
      : [join(dir, "node_modules", ".bin", "wrangler"), "dev", ...rest];
  const proc = Bun.spawn(argv, {
    cwd: command === "test" ? REPO_ROOT : dir,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, DORIFACE_RELAY_DIR: dir },
  });
  return proc.exited;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv[2], process.argv.slice(3));
  } catch (error) {
    if (!(error instanceof RelayUnreachable)) throw error;
    console.error(`
Could not fetch the relay (${error.message}).

The relay is a separate private service, github.com/sisyphuslabs/doriface-relay. Its public contract is
docs/transport.md. Without access, \`bun run check\` still runs every other suite; only the relay suites in tests/relay
need this checkout. With access, let git reach the repository (\`gh auth setup-git\`, or
DORIFACE_RELAY_REPO=git@github.com:sisyphuslabs/doriface-relay.git for SSH) and run \`bun run relay:fetch\` again.`);
    process.exitCode = 1;
  }
}
