import { describe, expect, test } from "bun:test";
import { fileIsGone } from "./lock.ts";

const failure = (code: string): Error => Object.assign(new Error(code), { code });

describe("a lock generation another process is deleting reads as gone (#464)", () => {
  test.each([
    ["ENOENT", "linux", true],
    ["ENOENT", "win32", true],
    ["EPERM", "win32", true],
    ["EPERM", "linux", false],
    ["EPERM", "darwin", false],
    ["EACCES", "win32", false],
    ["EBUSY", "win32", false],
    ["EISDIR", "win32", false],
  ] as const)("%s on %s: gone %p", (code, platform, gone) => {
    expect(fileIsGone(failure(code), platform)).toBe(gone);
  });

  test("anything that is not an error with a code is not gone", () => {
    expect(fileIsGone("EPERM", "win32")).toBe(false);
    expect(fileIsGone(new Error("EPERM"), "win32")).toBe(false);
  });
});
