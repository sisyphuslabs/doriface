import { describe, expect, test } from "bun:test";
import { parseBenchArgs, UsageError } from "./bench-args.ts";

const refused = (argv: readonly string[]): string => {
  try {
    parseBenchArgs(argv);
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    return (error as Error).message;
  }
  throw new Error(`accepted ${argv.join(" ")}`);
};

describe("parseBenchArgs", () => {
  test("defaults: 200 measured calls after 10 warm-up calls", () => {
    expect(parseBenchArgs(["direct"])).toEqual({ mode: "direct", hc: "hc", calls: 200, warmup: 10 });
  });

  test("relay and healthz take the relay URL, relay the code too", () => {
    expect(parseBenchArgs(["relay", "--relay", "https://r.example", "--code", "AB12", "--calls", "500"])).toEqual({
      mode: "relay",
      relay: "https://r.example",
      code: "AB12",
      calls: 500,
      warmup: 10,
    });
    expect(parseBenchArgs(["healthz", "--relay", "https://r.example", "--warmup", "0"])).toEqual({
      mode: "healthz",
      relay: "https://r.example",
      calls: 200,
      warmup: 0,
    });
  });

  test.each(["abc", "", "1e3", "2.5", "-5", "0x10", " 200", "Infinity"])(
    "--calls %p is not a whole number",
    (value) => {
      expect(refused(["direct", `--calls=${value}`])).toContain("--calls wants a whole number");
    },
  );

  test.each(["0", "1", "99"])("--calls %p is too few samples for a p99", (value) => {
    expect(refused(["direct", `--calls=${value}`])).toContain("--calls must be at least 100");
  });

  test.each(["abc", "-1", "1.5"])("--warmup %p is refused", (value) => {
    expect(refused(["direct", `--warmup=${value}`])).toContain("--warmup wants a whole number");
  });

  test("a mode is required, and must be known", () => {
    expect(refused([])).toContain("name one mode");
    expect(refused(["sideways"])).toContain("unknown mode");
  });

  test("relay mode without --relay or --code, an unknown option, a missing value: all refused", () => {
    expect(refused(["relay", "--code", "AB12"])).toContain("relay mode needs --relay");
    expect(refused(["relay", "--relay", "https://r.example"])).toContain("relay mode needs --code");
    expect(refused(["healthz"])).toContain("healthz mode needs --relay");
    expect(refused(["direct", "--session", "x"])).toContain("--session");
    expect(refused(["direct", "--calls"])).toContain("--calls");
  });
});
