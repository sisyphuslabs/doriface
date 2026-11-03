import type { StreamClose } from "@doriface/client";
import { describe, expect, test } from "bun:test";
import { closesTab, terminalEnd } from "./terminal-end.ts";

const close = (by: StreamClose["by"]): StreamClose => ({
  by,
  reason: "test",
  exit_code: null,
  signal: null,
  finished_ms: null,
});

describe("terminalEnd", () => {
  test.each([
    ["core", "finished", true],
    ["viewer", "detached", false],
    ["connection", "live", false],
  ] as const)("a stream closed by %s ends as %s; closes its tab: %p", (by, end, closes) => {
    expect(terminalEnd(close(by))).toBe(end);
    expect(closesTab(terminalEnd(close(by)))).toBe(closes);
  });
});
