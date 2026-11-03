import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateJson, writePrivateJson } from "./files.ts";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "dh-files-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs `write` with fsync, rename and link passing through to node:fs, and returns their order. */
function durabilityOrder(write: () => unknown): readonly string[] {
  const order: string[] = [];
  const { fsyncSync, renameSync, linkSync } = fs;
  const spies = [
    spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      order.push("fsync");
      fsyncSync(fd);
    }),
    spyOn(fs, "renameSync").mockImplementation((from, to) => {
      order.push("rename");
      renameSync(from, to);
    }),
    spyOn(fs, "linkSync").mockImplementation((from, to) => {
      order.push("link");
      linkSync(from, to);
    }),
  ];
  try {
    write();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return order;
}

describe("private state files", () => {
  test("writePrivateJson flushes the temporary file before the rename and the directory after it", () => {
    expect(durabilityOrder(() => writePrivateJson(join(dir, "devices.json"), { ok: true }))).toEqual([
      "fsync",
      "rename",
      "fsync",
    ]);
    expect(JSON.parse(fs.readFileSync(join(dir, "devices.json"), "utf8"))).toEqual({ ok: true });
  });

  test("createPrivateJson flushes the temporary file before the link and the directory after it", () => {
    expect(durabilityOrder(() => createPrivateJson(join(dir, "host-keys.json"), { ok: true }))).toEqual([
      "fsync",
      "link",
      "fsync",
    ]);
  });
});
