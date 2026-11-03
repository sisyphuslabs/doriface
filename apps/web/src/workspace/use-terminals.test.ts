import { describe, expect, test } from "bun:test";
import { machineCount } from "./use-terminals.ts";

describe("machineCount", () => {
  test("a terminal.list answer without machines counts as none instead of throwing", () => {
    expect(machineCount({ terminals: [], hidden_finished: 0 })).toBe(0);
    expect(machineCount({ machines: null })).toBe(0);
  });

  test("counts the machines the host listed", () => {
    expect(machineCount({ machines: [{ name: "a" }, { name: "b" }] })).toBe(2);
  });
});
