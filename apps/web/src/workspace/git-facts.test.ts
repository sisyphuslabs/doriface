import type { GitFacts, Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { shownGit } from "./git-facts.ts";
import { toSpaces } from "./model.ts";

const clean: GitFacts = { branch: "main", detached: false, onDefault: true, ahead: 0, behind: 0, dirty: false };

describe("shownGit: only what is unusual", () => {
  test("a clean default branch in sync says nothing, and neither does a directory with no facts", () => {
    expect(shownGit(clean)).toBeUndefined();
    expect(shownGit(undefined)).toBeUndefined();
  });

  test("another branch, uncommitted changes, ahead, behind or a detached HEAD each say it", () => {
    expect(shownGit({ ...clean, branch: "feat/x", onDefault: false })).toEqual({
      branch: "feat/x",
      detached: false,
      ahead: 0,
      behind: 0,
      dirty: false,
    });
    expect(shownGit({ ...clean, dirty: true })?.dirty).toBe(true);
    expect(shownGit({ ...clean, ahead: 2 })?.ahead).toBe(2);
    expect(shownGit({ ...clean, behind: 3 })?.behind).toBe(3);
    const { branch: _, ...detached } = { ...clean, detached: true, onDefault: false };
    expect(shownGit(detached)).toEqual({ detached: true, ahead: 0, behind: 0, dirty: false });
  });
});

const terminal = (address: string, space: string, cwd: string, foreground?: string): Terminal =>
  ({
    address,
    cwd,
    state: "live",
    labels: { space },
    ...(foreground === undefined ? {} : { foreground: { cwd: foreground, argv: [], name: "sh", pid: 1 } }),
  }) as unknown as Terminal;

describe("toSpaces with git facts", () => {
  test("a space's facts are its first tab's directory's, on its own machine", () => {
    const asked: [string | undefined, string][] = [];
    const facts = { ...clean, branch: "feat/x", onDefault: false };
    const spaces = toSpaces(
      [
        terminal("t1", "api", "/w/api", "/w/api/src"),
        terminal("t2", "api", "/w/other"),
        terminal("box/t3", "docs", "/srv/docs"),
      ],
      (machine, dir) => {
        asked.push([machine, dir]);
        return dir === "/w/api/src" ? facts : undefined;
      },
    );
    expect(asked).toEqual([
      [undefined, "/w/api/src"],
      ["box", "/srv/docs"],
    ]);
    expect(spaces.find((space) => space.name === "api")?.git?.branch).toBe("feat/x");
    expect(spaces.find((space) => space.name === "docs")?.git).toBeUndefined();
  });
});
