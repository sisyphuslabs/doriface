import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedGitEnv } from "./git-env.ts";

const SUITE = join(import.meta.dir, "private-relay.test.ts");
const REPO_ROOT = join(import.meta.dir, "..", "..");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "relay-fetch-caller-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: isolatedGitEnv(scratch), stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return out;
}

test("the fetch suite leaves the repository that runs it alone, even with git's hook environment exported", async () => {
  const caller = join(scratch, "caller");
  await git(scratch, "init", "--quiet", caller);
  writeFileSync(join(caller, "work.txt"), "committed\n");
  await git(caller, "add", ".");
  await git(caller, "commit", "--quiet", "-m", "caller");
  const state = async (): Promise<string> =>
    JSON.stringify({
      log: await git(caller, "log", "--all", "--format=%H %s"),
      status: await git(caller, "status", "--porcelain"),
      index: new Bun.CryptoHasher("sha256").update(readFileSync(join(caller, ".git", "index"))).digest("hex"),
      objects: await git(caller, "count-objects", "-v"),
    });
  const before = await state();

  // What a pre-commit hook or `git rebase -x` exports to the command it runs.
  const proc = Bun.spawn([process.execPath, "test", SUITE], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      GIT_DIR: join(caller, ".git"),
      GIT_INDEX_FILE: join(caller, ".git", "index"),
      GIT_PREFIX: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, report, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect({ code, failed: /\n\s*[1-9]\d* fail\n/.test(report) }).toEqual({ code: 0, failed: false });
  expect(await state()).toBe(before);
}, 180_000);
