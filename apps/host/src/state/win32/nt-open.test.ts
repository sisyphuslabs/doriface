import { describe, expect, test } from "bun:test";
import {
  CONTENTION_WAIT_MS,
  ntPath,
  ntRequest,
  openRetrying,
  STATUS_FILE_LOCK_CONFLICT,
  STATUS_OBJECT_NAME_COLLISION,
  STATUS_SHARING_VIOLATION,
  Win32Error,
} from "./nt-open.ts";

const STATUS_ACCESS_DENIED = 0xc000_0022;
const STATUS_OBJECT_NAME_NOT_FOUND = 0xc000_0034;
/** RtlNtStatusToDosError for the statuses these tests use. */
const toDos = (status: number): number =>
  ({
    [STATUS_SHARING_VIOLATION]: 32,
    [STATUS_FILE_LOCK_CONFLICT]: 33,
    [STATUS_ACCESS_DENIED]: 5,
    [STATUS_OBJECT_NAME_NOT_FOUND]: 2,
    [STATUS_OBJECT_NAME_COLLISION]: 183,
  })[status] ?? 317;

/** An NtCreateFile that answers each status in turn, then succeeds with handle 7. */
function opens(...statuses: number[]): {
  readonly attempt: () => { status: number; handle: bigint };
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    attempt: () => ({ status: statuses[calls++] ?? 0, handle: 7n }),
    calls: () => calls,
  };
}
const caught = (run: () => unknown): Win32Error => {
  try {
    run();
  } catch (error) {
    if (error instanceof Win32Error) return error;
    throw error;
  }
  throw new Error("did not throw");
};
const noSleep = (): void => {};

describe("an open's failure carries its own status, never a later GetLastError (#464)", () => {
  test("a sharing violation, then success: the open waits and returns the handle", () => {
    const open = opens(STATUS_SHARING_VIOLATION, STATUS_FILE_LOCK_CONFLICT);
    expect(openRetrying(open.attempt, toDos, noSleep)).toBe(7n);
    expect(open.calls()).toBe(3);
  });

  test("a sharing violation that outlasts the wait throws with its true code, 32", () => {
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const error = caught(() =>
        openRetrying(
          () => ({ status: STATUS_SHARING_VIOLATION, handle: 0n }),
          toDos,
          (ms) => {
            now += ms;
          },
        ),
      );
      expect(error.code).toBe(32);
      expect(now).toBeGreaterThanOrEqual(CONTENTION_WAIT_MS);
    } finally {
      Date.now = realNow;
    }
  });

  test.each([
    [STATUS_ACCESS_DENIED, 5],
    [STATUS_OBJECT_NAME_NOT_FOUND, 2],
    [STATUS_OBJECT_NAME_COLLISION, 80],
  ])("status %p throws at once with code %p, never 0", (status, code) => {
    const open = opens(status);
    const error = caught(() => openRetrying(open.attempt, toDos, noSleep));
    expect(error.code).toBe(code);
    expect(error.call).toBe("NtCreateFile");
    expect(open.calls()).toBe(1);
  });
});

describe("the NtCreateFile request is the one CreateFileW makes", () => {
  test.each([
    ["C:\\Users\\a\\state\\known-hosts.json", "\\??\\C:\\Users\\a\\state\\known-hosts.json"],
    ["C:/Users/a/state", "\\??\\C:\\Users\\a\\state"],
    ["\\\\?\\D:\\x", "\\??\\D:\\x"],
    ["\\\\server\\share\\x", "\\??\\UNC\\server\\share\\x"],
  ])("%s -> %s", (path, nt) => {
    expect(ntPath(path)).toBe(nt);
  });

  test("a relative path is refused", () => {
    expect(() => ntPath("state\\x")).toThrow(RangeError);
  });

  test("CREATE_NEW with write-through on a file; OPEN_EXISTING with backup semantics on a folder", () => {
    expect(ntRequest({ access: 0x4002_0000, share: 0, disposition: 1, flags: 0x8020_0000 })).toEqual({
      access: 0x4012_0080,
      attributes: 0x80,
      share: 0,
      disposition: 2,
      createOptions: 0x20 | 0x40 | 0x20_0000 | 0x2,
    });
    expect(ntRequest({ access: 0x8000_0000, share: 3, disposition: 3, flags: 0x0220_0000 }).createOptions).toBe(
      0x20 | 0x4000 | 0x20_0000,
    );
    expect(ntRequest({ access: 0, share: 0, disposition: 3, flags: 0 }).disposition).toBe(1);
  });
});
