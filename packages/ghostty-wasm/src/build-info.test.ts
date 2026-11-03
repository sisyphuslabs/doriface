import { describe, expect, test } from "bun:test";
import buildJson from "../wasm/build.json" with { type: "json" };
import { BuildInfoError, parseBuildInfo } from "./build-info.ts";

function rejectedField(value: unknown): string {
  try {
    parseBuildInfo(value);
  } catch (error) {
    if (error instanceof BuildInfoError) return error.field;
    throw error;
  }
  throw new Error("parseBuildInfo accepted the value");
}

function withPatch(index: number, patch: unknown): unknown {
  return { ...buildJson, patches: buildJson.patches.map((entry, at) => (at === index ? patch : entry)) };
}

describe("parseBuildInfo", () => {
  test("accepts the committed build.json unchanged", () => {
    expect(parseBuildInfo(buildJson)).toEqual(buildJson);
  });

  test.each<[string, unknown, string]>([
    ["a non-object root", [], "root"],
    ["a short ghostty commit", { ...buildJson, ghosttyCommit: "83fb956" }, "ghosttyCommit"],
    ["an uppercase wterm commit", { ...buildJson, wtermCommit: buildJson.wtermCommit.toUpperCase() }, "wtermCommit"],
    ["a truncated archive digest", { ...buildJson, ghosttyArchiveSha256: "7759929e" }, "ghosttyArchiveSha256"],
    ["a non-hex wasm digest", { ...buildJson, sha256: "z".repeat(64) }, "sha256"],
    ["an empty zig version", { ...buildJson, zig: "" }, "zig"],
    ["zero bytes", { ...buildJson, bytes: 0 }, "bytes"],
    ["fractional bytes", { ...buildJson, bytes: 1.5 }, "bytes"],
    ["bytes as a string", { ...buildJson, bytes: "665834" }, "bytes"],
    ["patches as an object", { ...buildJson, patches: {} }, "patches"],
    ["a patch that is not an object", withPatch(1, "0002.patch"), "patches[1]"],
    ["a patch without a path", withPatch(2, { sha256: "0".repeat(64) }), "patches[2].path"],
    [
      "a patch path outside patches/",
      withPatch(3, { path: "patches/../package.json", sha256: "0".repeat(64) }),
      "patches[3].path",
    ],
    [
      "a patch path that is not a .patch",
      withPatch(0, { path: "patches/ghostty/0001.diff", sha256: "0".repeat(64) }),
      "patches[0].path",
    ],
    [
      "a patch with a bad digest",
      withPatch(4, { path: "patches/ghostty/0005.patch", sha256: "abc" }),
      "patches[4].sha256",
    ],
  ])("rejects %s", (_name, value, field) => {
    expect(rejectedField(value)).toBe(field);
  });
});
