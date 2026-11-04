import { describe, expect, test } from "bun:test";
import { workspaceSettled } from "./use-arrival-ready.ts";

const shown = (open: readonly string[]) => ({ open, restored: true });

describe("workspaceSettled", () => {
  test("not before the terminals are listed", () => {
    expect(workspaceSettled(false, shown(["t1"]), 1)).toBe(false);
  });

  test("not while the default tab of a listed workspace has yet to open", () => {
    expect(workspaceSettled(true, shown([]), 2)).toBe(false);
    expect(workspaceSettled(true, shown(["t1"]), 2)).toBe(true);
  });

  test("an empty workspace is settled with no tab", () => {
    expect(workspaceSettled(true, shown([]), 0)).toBe(true);
  });

  test("not while a kept tab waits for machine.list to name its machine", () => {
    expect(workspaceSettled(true, { open: ["t1"], restored: false }, 2)).toBe(false);
  });
});
