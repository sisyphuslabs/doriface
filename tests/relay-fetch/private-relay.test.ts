import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the shipped tests/relay/private-relay.ts from a scratch parent repository against a local file:// stand-in
// for the private relay, so no credentials and no network are involved.
const SCRIPT = join(import.meta.dir, "..", "relay", "private-relay.ts");
const scratch = mkdtempSync(join(tmpdir(), "relay-fetch-"));
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: join(scratch, "gitconfig"),
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

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
  writeFileSync(join(scratch, "gitconfig"), "");
  standIn = join(scratch, "relay-stand-in");
  mkdirSync(standIn);
  await git(standIn, "init", "--quiet");
  writeFileSync(join(standIn, "relay.txt"), "the private relay\n");
  await git(standIn, "add", ".");
  await git(standIn, "commit", "--quiet", "-m", "relay");
  standInRev = await git(standIn, "rev-parse", "HEAD");
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function parentWith(name: string, relayGit: (dotGit: string) => void): Promise<string> {
  const parent = join(scratch, name);
  mkdirSync(join(parent, "tests", "relay"), { recursive: true });
  await git(parent, "init", "--quiet");
  copyFileSync(SCRIPT, join(parent, "tests", "relay", "private-relay.ts"));
  writeFileSync(join(parent, "relay-pin.json"), JSON.stringify({ repository: "example/relay", rev: standInRev }));
  writeFileSync(join(parent, "work.txt"), "committed\n");
  await git(parent, "add", ".");
  await git(parent, "commit", "--quiet", "-m", "public");
  writeFileSync(join(parent, "work.txt"), "uncommitted work\n");
  relayGit(join(parent, ".relay", ".git"));
  return parent;
}

async function fetchFrom(parent: string): Promise<number> {
  const env: Record<string, string | undefined> = { ...gitEnv, DORIFACE_RELAY_REPO: `file://${standIn}` };
  delete env["DORIFACE_RELAY_DIR"];
  const proc = Bun.spawn([process.execPath, join(parent, "tests", "relay", "private-relay.ts"), "fetch"], {
    cwd: parent,
    env,
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exited;
}

describe("relay:fetch never acts on the repository around .relay", () => {
  const broken: ReadonlyArray<readonly [string, (dotGit: string) => void]> = [
    ["an empty .relay/.git", (dotGit) => mkdirSync(dotGit, { recursive: true })],
    [
      "a corrupt .relay/.git",
      (dotGit) => {
        mkdirSync(dotGit, { recursive: true });
        writeFileSync(join(dotGit, "HEAD"), "not a ref\n");
      },
    ],
  ];
  for (const [label, make] of broken) {
    test(`${label} is refused, and the parent's tree, HEAD and objects are untouched`, async () => {
      const parent = await parentWith(label.replaceAll(/\W+/g, "-"), make);
      const head = await git(parent, "rev-parse", "HEAD");

      expect(await fetchFrom(parent)).not.toBe(0);

      expect(await git(parent, "rev-parse", "HEAD")).toBe(head);
      expect(await git(parent, "status", "--porcelain", "--untracked-files=no")).toBe("M work.txt");
      expect(readFileSync(join(parent, "work.txt"), "utf8")).toBe("uncommitted work\n");
      expect(await gitFails(parent, "cat-file", "-e", `${standInRev}^{commit}`)).toBe(true);
    });
  }
});
