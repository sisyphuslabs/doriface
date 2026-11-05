import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PRIVATE_STATE_FILES } from "./private-state.ts";

const SOURCE = join(import.meta.dir, "..", "..");
const PRIVATE_IO = /\b(?:readJson|writePrivateJson|createPrivateJson)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "testing" ? [] : sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("every file a private reader or writer names is in the Windows preflight inventory (#406)", () => {
  const missing: string[] = [];
  for (const path of sources(SOURCE)) {
    const text = readFileSync(path, "utf8");
    if (!PRIVATE_IO.test(text) || path.endsWith(join("state", "files.ts"))) continue;
    for (const [, name] of text.matchAll(/"([a-z][a-z-]*\.json)"/g)) {
      if (name !== undefined && !(PRIVATE_STATE_FILES as readonly string[]).includes(name)) {
        missing.push(`${relative(SOURCE, path)}: ${name}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
