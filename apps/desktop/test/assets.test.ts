import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveAsset } from "../src/main/assets.ts";

const root = join(import.meta.dir, "..", "test-fixtures", "web");

describe("app: asset resolution", () => {
  test("serves files under the web root", () => {
    expect(resolveAsset(root, "app://doriface/")).toBe(join(root, "index.html"));
    expect(resolveAsset(root, "app://doriface/placeholder.js")).toBe(join(root, "placeholder.js"));
  });

  test("falls back to index.html for client-side routes only", () => {
    expect(resolveAsset(root, "app://doriface/hosts/abc")).toBe(join(root, "index.html"));
    expect(resolveAsset(root, "app://doriface/missing.js")).toBeUndefined();
  });

  test("refuses other hosts and paths that escape the root", () => {
    expect(resolveAsset(root, "app://other/index.html")).toBeUndefined();
    expect(resolveAsset(root, "app://doriface/%2e%2e/%2e%2e/package.json")).toBeUndefined();
    expect(resolveAsset(root, "app://doriface/..%2fpackage.json")).toBeUndefined();
    expect(resolveAsset(root, "app://doriface/%E0%A4%A")).toBeUndefined();
    expect(resolveAsset(root, "app://doriface/index.html%00.js")).toBeUndefined();
  });
});
