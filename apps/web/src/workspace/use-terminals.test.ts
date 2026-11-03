import type { MachineView } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { machineCount } from "./use-terminals.ts";

const machine = (name: string): MachineView => ({
  host: name,
  id: `id-${name}`,
  name,
  state: "connected",
  target: name,
  version: "0.1.17",
});

describe("machineCount", () => {
  test("a terminal.list answer without machines counts as none instead of throwing", () => {
    expect(machineCount({})).toBe(0);
  });

  test("counts the machines the host listed", () => {
    expect(machineCount({ machines: [machine("a"), machine("b")] })).toBe(2);
  });
});
