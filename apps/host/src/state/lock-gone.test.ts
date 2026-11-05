import { describe, expect, test } from "bun:test";
import { removeLockFile, whileDeletePending } from "./lock.ts";

const failure = (code: string): Error => Object.assign(new Error(code), { code });

const alwaysRefused = (): string => {
  throw failure("EPERM");
};

/** A read that fails with each code in turn, then returns "content". */
function reads(...codes: string[]): { readonly read: () => string; readonly calls: () => number } {
  let calls = 0;
  return {
    read: () => {
      const code = codes[calls++];
      if (code === undefined) return "content";
      throw failure(code);
    },
    calls: () => calls,
  };
}

describe("a lock generation another process is deleting is waited out on Windows (#464)", () => {
  test("EPERM while the file is delete-pending, then the open succeeds: the content is read", () => {
    const file = reads("EPERM", "EPERM");
    expect(whileDeletePending(file.read, "win32")).toBe("content");
    expect(file.calls()).toBe(3);
  });

  test("EPERM, then the delete completes: ENOENT reaches the caller, which reads it as gone", () => {
    const file = reads("EPERM", "ENOENT");
    expect(() => whileDeletePending(file.read, "win32")).toThrow("ENOENT");
  });

  test("an EPERM that outlasts the wait is a real refusal and is thrown", () => {
    const started = Date.now();
    expect(() => whileDeletePending(alwaysRefused, "win32", 30)).toThrow("EPERM");
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  });

  test.each(["linux", "darwin"] as const)("EPERM on %s is thrown at once", (platform) => {
    const file = reads("EPERM");
    expect(() => whileDeletePending(file.read, platform)).toThrow("EPERM");
    expect(file.calls()).toBe(1);
  });

  test.each(["EACCES", "EBUSY", "EISDIR"])("%s on win32 is thrown at once", (code) => {
    const file = reads(code);
    expect(() => whileDeletePending(file.read, "win32")).toThrow(code);
    expect(file.calls()).toBe(1);
  });
});

/** A file another process is deleting: the second delete fails with `code` until the file is gone after `polls` checks. */
const pending = (code: string, polls: number) => {
  let checks = 0;
  return {
    remove: () => {
      throw failure(code);
    },
    exists: () => ++checks <= polls,
    checks: () => checks,
  };
};

describe("a lock file two processes remove at once (#464)", () => {
  test.each(["EPERM", "EFAULT"])("%s on win32 while the other delete completes: removed, nothing thrown", (code) => {
    const io = pending(code, 2);
    expect(() => removeLockFile("gen", "win32", 1000, io)).not.toThrow();
    expect(io.checks()).toBe(3);
  });

  test("a refusal that outlasts the wait with the file still there is thrown", () => {
    expect(() => removeLockFile("gen", "win32", 30, pending("EPERM", Number.POSITIVE_INFINITY))).toThrow("EPERM");
  });

  test.each(["linux", "darwin"] as const)("EPERM on %s is thrown at once", (platform) => {
    const io = pending("EPERM", 5);
    expect(() => removeLockFile("gen", platform, 1000, io)).toThrow("EPERM");
    expect(io.checks()).toBe(0);
  });

  test("EBUSY on win32 is thrown at once", () => {
    expect(() => removeLockFile("gen", "win32", 1000, pending("EBUSY", 5))).toThrow("EBUSY");
  });
});
