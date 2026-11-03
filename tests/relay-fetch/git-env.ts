import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const listed = Bun.spawnSync(["git", "rev-parse", "--local-env-vars"], { stdout: "pipe", stderr: "ignore" });
/** The variables that point git at a repository, index or object store, as git itself lists them. */
const REPOSITORY_VARIABLES = new Set(listed.stdout.toString().split("\n").filter(Boolean));
if (!REPOSITORY_VARIABLES.has("GIT_DIR")) throw new Error("git rev-parse --local-env-vars did not answer");

/**
 * An environment for the tests' own git calls that cannot reach the repository the tests run in: under a hook or
 * `git rebase -x` git exports an absolute GIT_DIR (and more), which would send `git init/add/commit` there. Config
 * and identity come from `scratch` only.
 */
export function isolatedGitEnv(scratch: string): Record<string, string | undefined> {
  const home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, ".gitconfig"), "");
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !REPOSITORY_VARIABLES.has(name) && !name.startsWith("GIT_CONFIG")),
  );
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CEILING_DIRECTORIES: scratch,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
}
