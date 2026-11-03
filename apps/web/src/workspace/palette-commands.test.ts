import type { Terminal } from "@doriface/protocol";
import { describe, expect, test } from "bun:test";
import { resolveKeymap } from "../keys/keymap.ts";
import { choiceOf, paletteCommands } from "./palette-commands.ts";
import { availableActions, type Shell } from "./shell-actions.ts";

const terminal = (fields: Partial<Terminal>): Terminal => ({
  address: "t1",
  argv: ["sh"],
  cols: 80,
  rows: 24,
  created_ms: 0,
  cwd: "/work/doriface",
  labels: {},
  screen: "exact",
  state: "live",
  ...fields,
});

const source = (terminals: readonly Terminal[], shell: Shell = "desktop") => ({
  actions: availableActions(shell, { open: ["t1", "t2"] }),
  terminals,
  host: "studio",
  route: "relay",
  platform: "mac" as const,
  keymap: resolveKeymap("mac", new Map()),
});

describe("paletteCommands", () => {
  test("lists live agents with their state, then actions, the host and settings", () => {
    const commands = paletteCommands(
      source([
        terminal({ address: "box/t1", name: "deploy", status: { state: "blocked" } }),
        terminal({ address: "t2", state: "finished" }),
      ]),
    );
    expect([...new Set(commands.map((command) => command.group))]).toEqual(["Agents", "Actions", "Hosts", "General"]);
    expect(commands.filter((command) => command.group === "Agents")).toEqual([
      { id: "agent:box/t1", label: "deploy", group: "Agents", status: "blocked", hint: "box" },
    ]);
    expect(commands.find((command) => command.id === "tab.new")?.keys).toEqual(["⌘", "T"]);
    expect(commands.find((command) => command.group === "Hosts")).toMatchObject({ label: "studio", hint: "relay" });
  });

  test("agents that need you come first", () => {
    const commands = paletteCommands(
      source([
        terminal({ address: "t1", name: "shell" }),
        terminal({ address: "t2", name: "deploy", status: { state: "blocked" } }),
      ]),
    );
    expect(commands.filter((command) => command.group === "Agents").map((command) => command.label)).toEqual([
      "deploy",
      "shell",
    ]);
  });

  test("a phone's palette lists only what the phone shell handles", () => {
    const labels = paletteCommands(source([], "phone")).map((command) => command.label);
    expect(labels).toEqual(["New tab", "Larger terminal text", "Smaller terminal text", "studio", "Open settings"]);
  });

  test("split is listed only once there are two tabs to split", () => {
    expect(availableActions("desktop", { open: ["t1"] })).not.toContain("pane.split");
    expect(availableActions("desktop", { open: ["t1", "t2"] })).toContain("pane.split");
  });

  test("every row runs something", () => {
    expect(choiceOf("agent:box/t1")).toEqual({ kind: "agent", address: "box/t1" });
    expect(choiceOf("host:studio")).toEqual({ kind: "settings" });
    expect(choiceOf("app.settings")).toEqual({ kind: "action", id: "app.settings" });
  });
});
