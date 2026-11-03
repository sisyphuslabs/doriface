import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutVariants, relay } from "./checkout-variants.ts";
import { isolatedGitEnv } from "./git-env.ts";

// Runs the shipped tests/relay/private-relay.ts from a scratch parent repository against a local file:// stand-in
// for the private relay, so no credentials and no network are involved.
const SCRIPT = join(import.meta.dir, "..", "relay", "private-relay.ts");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "relay-fetch-")));
const SECRET_NAMES = ["RELAY_READ_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];
// Each row spawns bun, git and an install; on a loaded host one took 4.9 s, so the 5 s default passes by luck.
const ROW_TIMEOUT_MS = 60_000;
const gitEnv = isolatedGitEnv(scratch);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err}`);
  return out.trim();
}

async function gitFails(cwd: string, ...args: string[]): Promise<boolean> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: gitEnv, stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) !== 0;
}

let standIn = "";
let standInRev = "";

beforeAll(async () => {
  standIn = join(scratch, "relay-stand-in");
  mkdirSync(standIn);
  await git(standIn, "init", "--quiet");
  writeFileSync(join(standIn, "relay.txt"), "the private relay\n");
  // Its install records how many credential variables a lifecycle script could read.
  const probe = `require("fs").writeFileSync("install-saw.txt", String(Object.keys(process.env).filter((k) => ${JSON.stringify(SECRET_NAMES)}.includes(k) || k.startsWith("GIT_CONFIG_")).length))`;
  writeFileSync(
    join(standIn, "package.json"),
    JSON.stringify({ name: "relay-stand-in", private: true, scripts: { postinstall: `bun -e '${probe}'` } }),
  );
  await git(standIn, "add", ".");
  await git(standIn, "commit", "--quiet", "-m", "relay");
  standInRev = await git(standIn, "rev-parse", "HEAD");
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function publicCheckout(name: string): Promise<string> {
  const parent = join(scratch, name);
  mkdirSync(join(parent, "tests", "relay"), { recursive: true });
  await git(parent, "init", "--quiet");
  copyFileSync(SCRIPT, join(parent, "tests", "relay", "private-relay.ts"));
  writeFileSync(join(parent, "relay-pin.json"), JSON.stringify({ repository: "example/relay", rev: standInRev }));
  writeFileSync(join(parent, "work.txt"), "committed\n");
  writeFileSync(join(parent, "staged.txt"), "committed\n");
  await git(parent, "add", ".");
  await git(parent, "commit", "--quiet", "-m", "public");
  writeFileSync(join(parent, "staged.txt"), "staged work\n");
  await git(parent, "add", "staged.txt");
  writeFileSync(join(parent, "work.txt"), "uncommitted work\n");
  return parent;
}

async function snapshot(parent: string): Promise<string> {
  const gitDir = join(parent, ".git");
  return JSON.stringify({
    head: await git(parent, "rev-parse", "HEAD"),
    worktrees: await git(parent, "worktree", "list", "--porcelain"),
    branch: await git(parent, "symbolic-ref", "--quiet", "HEAD"),
    status: await git(parent, "status", "--porcelain", "--untracked-files=no"),
    untracked: (await git(parent, "status", "--porcelain", "--untracked-files=all"))
      .split("\n")
      .filter((line) => line.startsWith("?? ") && !line.startsWith("?? .relay/")),
    index: new Bun.CryptoHasher("sha256").update(readFileSync(join(gitDir, "index"))).digest("hex"),
    work: readFileSync(join(parent, "work.txt"), "utf8"),
    relayObjectAbsent: await gitFails(parent, "cat-file", "-e", `${standInRev}^{commit}`),
  });
}

async function fetchFrom(
  parent: string,
  extra: Readonly<Record<string, string>> = {},
): Promise<{ readonly code: number; readonly stderr: string }> {
  const env: Record<string, string | undefined> = { ...gitEnv, ...extra, DORIFACE_RELAY_REPO: `file://${standIn}` };
  delete env["DORIFACE_RELAY_DIR"];
  const proc = Bun.spawn([process.execPath, join(parent, "tests", "relay", "private-relay.ts"), "fetch"], {
    cwd: parent,
    env,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

// The script's own refusal, as opposed to a crash or a git error that also exits non-zero.
const REFUSAL = "is not a git checkout of its own";

const variants = checkoutVariants(git);

describe("relay:fetch never acts on the repository around .relay", () => {
  test.each(variants.map((v) => [v.name, v] as const))(
    "%s",
    async (_name, variant) => {
      const parent = await publicCheckout(variant.name.replaceAll(/\W+/g, "-"));
      const caller = await variant.arrange(parent);
      const before = await snapshot(parent);

      const { code, stderr } = await fetchFrom(parent, caller);

      expect(await snapshot(parent)).toBe(before);
      if (variant.outcome === "refused") {
        expect({ code, refused: stderr.includes(REFUSAL) }).toEqual({ code: 1, refused: true });
      } else {
        expect(code).toBe(0);
        expect(await git(relay(parent), "rev-parse", "HEAD")).toBe(standInRev);
      }
    },
    ROW_TIMEOUT_MS,
  );
});

test(
  "a fresh fetch checks out the pin, and the relay's install sees none of the fetch credentials",
  async () => {
    const parent = await publicCheckout("fresh");
    const before = await snapshot(parent);
    const credentials = {
      RELAY_READ_TOKEN: "synthetic-not-a-token",
      GH_TOKEN: "synthetic-not-a-token",
      GITHUB_TOKEN: "synthetic-not-a-token",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.quotePath",
      GIT_CONFIG_VALUE_0: "false",
    };

    expect((await fetchFrom(parent, credentials)).code).toBe(0);

    expect(await git(relay(parent), "rev-parse", "HEAD")).toBe(standInRev);
    expect(readFileSync(join(relay(parent), "install-saw.txt"), "utf8")).toBe("0");
    expect(await snapshot(parent)).toBe(before);
  },
  ROW_TIMEOUT_MS,
);
