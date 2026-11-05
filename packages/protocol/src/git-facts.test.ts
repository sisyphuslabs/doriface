import { describe, expect, test } from "bun:test";
import { parseGitFacts } from "./git-facts.ts";

const facts = { branch: "feat/x", detached: false, onDefault: false, ahead: 2, behind: 0, dirty: true };

describe("parseGitFacts", () => {
  test("reads each directory's facts", () => {
    expect(parseGitFacts({ v: 1, dirs: { "/w/a": facts } })).toEqual({ v: 1, dirs: { "/w/a": facts } });
  });

  test("a detached HEAD carries no branch", () => {
    const detached = { detached: true, onDefault: false, ahead: 0, behind: 0, dirty: false };
    expect(parseGitFacts({ v: 1, dirs: { "/w/b": detached } })?.dirs["/w/b"]).toEqual(detached);
  });

  test("an entry it cannot read is left out, the rest are kept", () => {
    const parsed = parseGitFacts({ v: 1, dirs: { "/w/a": facts, "/w/bad": { ...facts, ahead: -1 }, "/w/c": "x" } });
    expect(Object.keys(parsed?.dirs ?? {})).toEqual(["/w/a"]);
  });

  test("another version, or no document, is nothing", () => {
    expect(parseGitFacts({ v: 2, dirs: {} })).toBeUndefined();
    expect(parseGitFacts(null)).toBeUndefined();
  });
});
