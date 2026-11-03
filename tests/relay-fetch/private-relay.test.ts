import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedGitEnv } from "./git-env.ts";

// Runs the shipped tests/relay/private-relay.ts from a scratch parent repository against a local file:// stand-in
// for the private relay, so no credentials and no network are involved.
const SCRIPT = join(import.meta.dir, "..", "relay", "private-relay.ts");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "relay-fetch-")));
const SECRET_NAMES = ["RELAY_READ_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];
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

async function fetchFrom(parent: string, extra: Readonly<Record<string, string>> = {}): Promise<number> {
  const env: Record<string, string | undefined> = { ...gitEnv, ...extra, DORIFACE_RELAY_REPO: `file://${standIn}` };
  delete env["DORIFACE_RELAY_DIR"];
  const proc = Bun.spawn([process.execPath, join(parent, "tests", "relay", "private-relay.ts"), "fetch"], {
    cwd: parent,
    env,
    stdout: "ignore",
    stderr: "ignore",
  });
  return proc.exited;
}

interface Variant {
  readonly name: string;
  readonly arrange: (parent: string) => Promise<Record<string, string>>;
  readonly outcome: "refused" | "fetched";
}

const relay = (parent: string): string => join(parent, ".relay");
const emptyRepo = async (parent: string): Promise<void> => {
  mkdirSync(relay(parent));
  await git(relay(parent), "init", "--quiet");
};

const variants: readonly Variant[] = [
  {
    name: "an empty .relay/.git",
    outcome: "refused",
    arrange: async (p) => (mkdirSync(join(relay(p), ".git"), { recursive: true }), {}),
  },
  {
    name: "a corrupt .relay/.git",
    outcome: "refused",
    arrange: async (p) => {
      mkdirSync(join(relay(p), ".git"), { recursive: true });
      writeFileSync(join(relay(p), ".git", "HEAD"), "not a ref\n");
      return {};
    },
  },
  { name: ".relay symlinked to the parent", outcome: "refused", arrange: async (p) => (symlinkSync(p, relay(p)), {}) },
  {
    name: ".relay/.git as a gitdir: file naming the parent's .git",
    outcome: "refused",
    arrange: async (p) => {
      mkdirSync(relay(p));
      writeFileSync(join(relay(p), ".git"), `gitdir: ${join(p, ".git")}\n`);
      return {};
    },
  },
  {
    name: ".relay/.git symlinked to the parent's .git",
    outcome: "refused",
    arrange: async (p) => (mkdirSync(relay(p)), symlinkSync(join(p, ".git"), join(relay(p), ".git")), {}),
  },
  {
    name: ".relay/.git sharing the parent's store through commondir",
    outcome: "refused",
    arrange: async (p) => {
      await emptyRepo(p);
      writeFileSync(join(relay(p), ".git", "commondir"), `${join(p, ".git")}\n`);
      return {};
    },
  },
  {
    name: ".relay/.git/objects symlinked to the parent's store",
    outcome: "refused",
    arrange: async (p) => {
      await emptyRepo(p);
      rmSync(join(relay(p), ".git", "objects"), { recursive: true });
      symlinkSync(join(p, ".git", "objects"), join(relay(p), ".git", "objects"));
      return {};
    },
  },
  {
    name: ".relay/.git/index symlinked to the parent's index",
    outcome: "refused",
    arrange: async (p) => {
      await emptyRepo(p);
      symlinkSync(join(p, ".git", "index"), join(relay(p), ".git", "index"));
      return {};
    },
  },
  {
    name: "core.worktree in .relay/.git/config naming the parent",
    outcome: "fetched",
    arrange: async (p) => {
      await emptyRepo(p);
      await git(relay(p), "config", "core.worktree", p);
      return {};
    },
  },
  {
    name: "GIT_DIR inherited (absolute), no .relay yet",
    outcome: "fetched",
    arrange: async (p) => ({ GIT_DIR: join(p, ".git") }),
  },
  {
    name: "GIT_DIR inherited (absolute), an empty .relay repository",
    outcome: "fetched",
    arrange: async (p) => (await emptyRepo(p), { GIT_DIR: join(p, ".git") }),
  },
  {
    name: "GIT_INDEX_FILE inherited",
    outcome: "fetched",
    arrange: async (p) => (await emptyRepo(p), { GIT_INDEX_FILE: join(p, ".git", "index") }),
  },
  {
    name: "GIT_OBJECT_DIRECTORY inherited",
    outcome: "fetched",
    arrange: async (p) => (await emptyRepo(p), { GIT_OBJECT_DIRECTORY: join(p, ".git", "objects") }),
  },
  {
    name: "the environment `git rebase -x` gives a command in a linked worktree",
    outcome: "fetched",
    arrange: async (p) => {
      await git(p, "worktree", "add", "--quiet", "-b", "linked", `${p}-linked`);
      return {
        GIT_DIR: join(p, ".git", "worktrees", `${p.split("/").at(-1) ?? ""}-linked`),
        GIT_REFLOG_ACTION: "rebase (exec)",
        GIT_PREFIX: "",
      };
    },
  },
];

describe("relay:fetch never acts on the repository around .relay", () => {
  test.each(variants.map((v) => [v.name, v] as const))("%s", async (_name, variant) => {
    const parent = await publicCheckout(variant.name.replaceAll(/\W+/g, "-"));
    const caller = await variant.arrange(parent);
    const before = await snapshot(parent);

    const code = await fetchFrom(parent, caller);

    expect(await snapshot(parent)).toBe(before);
    if (variant.outcome === "refused") {
      expect(code).not.toBe(0);
    } else {
      expect(code).toBe(0);
      expect(await git(relay(parent), "rev-parse", "HEAD")).toBe(standInRev);
    }
  });
});

test("a fresh fetch checks out the pin, and the relay's install sees none of the fetch credentials", async () => {
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

  expect(await fetchFrom(parent, credentials)).toBe(0);

  expect(await git(relay(parent), "rev-parse", "HEAD")).toBe(standInRev);
  expect(readFileSync(join(relay(parent), "install-saw.txt"), "utf8")).toBe("0");
  expect(await snapshot(parent)).toBe(before);
});
