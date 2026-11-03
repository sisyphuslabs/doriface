import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { appDir } from "./launch.ts";

/**
 * Builds `e2e/<source>` into the shared object `out` for LD_PRELOAD. A host without a C compiler fails here with a
 * message that says so, never a skip.
 */
export function buildPreloadShim(source: string, out: string): void {
  try {
    execFileSync("cc", ["-shared", "-fPIC", "-O2", "-o", out, join(appDir, "e2e", source), "-ldl"]);
  } catch (error) {
    if (Reflect.get(Object(error), "code") !== "ENOENT") throw error;
    throw new Error(`building e2e/${source} needs a C compiler named cc on PATH`, { cause: error });
  }
}
