import { describe, expect, test } from "bun:test";
import type { MachineView } from "@doriface/protocol";
import { replacedOf } from "./replaced.ts";

const machine = (target: string, via: boolean): MachineView => ({
  host: "box",
  id: "core-box",
  name: "old",
  state: "connected",
  target,
  version: "0",
  via,
});

describe("what a replaced machine had been added with", () => {
  test.each([
    ["an ssh target", machine("me@10.0.0.7:2222", false), "ssh"],
    ["the add-machine dialog's via", machine("doriface-host connect aaaaaaaaaaaaaaaaaaaaaaaaaa", true), "connect"],
    ["a via naming doriface-host by its path", machine("/opt/bin/doriface-host connect '<link>'", true), "connect"],
    ["a quoted path with a space", machine("'/Users/me/my bin/doriface-host' connect x", true), "connect"],
    ["another program's connect", machine("fly connect x", true), "command"],
    ["doriface-host with another verb", machine("doriface-host mesh status", true), "command"],
    ["an ssh via", machine("ssh -p 2222 -i key me@box", true), "command"],
  ] as const)("%s", (_, entry, kind) => {
    expect(replacedOf(entry)).toEqual({ name: "old", kind });
  });
});
