import { describe, expect, test } from "bun:test";
import { gitText, gitWords } from "./space-row.tsx";

describe("a space row's git state", () => {
  test("branch, a star for uncommitted changes, then ahead and behind", () => {
    const git = { branch: "feat/rows", detached: false, ahead: 1, behind: 2, dirty: true };
    expect(gitText(git)).toBe("feat/rows* \u21911 \u21932");
    expect(gitWords(git)).toBe("On feat/rows, 1 commit ahead, 2 commits behind, uncommitted changes");
  });

  test("a detached HEAD says so", () => {
    const git = { detached: true, ahead: 0, behind: 0, dirty: false };
    expect(gitText(git)).toBe("detached");
    expect(gitWords(git)).toBe("Detached HEAD");
  });
});
