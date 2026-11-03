import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The test's git, already confined to its scratch directory. */
export type Git = (cwd: string, ...args: string[]) => Promise<string>;

export interface Variant {
  readonly name: string;
  readonly arrange: (parent: string) => Promise<Record<string, string>>;
  readonly outcome: "refused" | "fetched";
}

export const relay = (parent: string): string => join(parent, ".relay");

/** Each way `.relay` or the caller's environment could point git at the repository around `.relay`. */
export function checkoutVariants(git: Git): readonly Variant[] {
  const emptyRepo = async (parent: string): Promise<void> => {
    mkdirSync(relay(parent));
    await git(relay(parent), "init", "--quiet");
  };

  return [
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
    {
      name: ".relay symlinked to the parent",
      outcome: "refused",
      arrange: async (p) => (symlinkSync(p, relay(p)), {}),
    },
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
      name: ".relay/.git/objects/pack symlinked to the parent's packs",
      outcome: "refused",
      arrange: async (p) => {
        await emptyRepo(p);
        rmSync(join(relay(p), ".git", "objects", "pack"), { recursive: true });
        symlinkSync(join(p, ".git", "objects", "pack"), join(relay(p), ".git", "objects", "pack"));
        return {};
      },
    },
    {
      name: "a symlink loop inside .relay/.git",
      outcome: "refused",
      arrange: async (p) => {
        await emptyRepo(p);
        symlinkSync("..", join(relay(p), ".git", "objects", "loop"));
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
}
