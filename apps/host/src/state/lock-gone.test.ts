import { describe, expect, test } from "bun:test";
import { whileDeletePending } from "./lock.ts";

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
