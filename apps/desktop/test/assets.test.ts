import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAsset } from "../src/main/assets.ts";

const root = join(import.meta.dir, "..", "test-fixtures", "web");
let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "dd-assets-"));
  writeFileSync(join(scratch, "index.html"), "<!doctype html>");
  writeFileSync(join(scratch, "..dots.js"), "");
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("app: asset resolution", () => {
  test("serves files under the web root", () => {
    expect(resolveAsset(root, "app://doriface/")).toBe(join(root, "index.html"));
    expect(resolveAsset(root, "app://doriface/placeholder.js")).toBe(join(root, "placeholder.js"));
    expect(resolveAsset(scratch, "app://doriface/..dots.js")).toBe(join(scratch, "..dots.js"));
  });

  test("falls back to index.html for client-side routes only", () => {
    expect(resolveAsset(root, "app://doriface/hosts/abc")).toBe(join(root, "index.html"));
    expect(resolveAsset(root, "app://doriface/missing.js")).toBeUndefined();
  });

  test("refuses encoded escapes that reach a real file outside the root", () => {
    // Two levels up from test-fixtures/web is apps/desktop, whose package.json exists.
    expect(existsSync(join(root, "..", "..", "package.json"))).toBe(true);
    expect(resolveAsset(root, "app://doriface/..%2f..%2fpackage.json")).toBeUndefined();
    expect(resolveAsset(root, "app://doriface/%2e%2e%2f%2e%2e%2fpackage.json")).toBeUndefined();
    expect(resolveAsset(root, "app://doriface/..%5c..%5cpackage.json")).toBeUndefined();
  });

  test("refuses other hosts, malformed escapes, NUL bytes and unstat-able names", () => {
    expect(resolveAsset(root, "app://other/index.html")).toBeUndefined();
    expect(resolveAsset(root, "app://doriface/%E0%A4%A")).toBeUndefined();
    expect(resolveAsset(root, "app://doriface/index.html%00.js")).toBeUndefined();
    expect(resolveAsset(root, `app://doriface/${"a".repeat(5000)}.js`)).toBeUndefined();
  });
});
