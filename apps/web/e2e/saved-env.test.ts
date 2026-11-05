import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSavedEnvIfWhole, type SavedEnv, writeSavedEnv } from "./saved-env.ts";

const SAVES = 4_000;
const short: SavedEnv = { hc: "/bin/hc", env: { HC_SESSION: "s" }, pid: 1 };
const long: SavedEnv = { hc: "/bin/hc", env: { HC_SESSION: "s".repeat(4_000) }, pid: 1, ready: true };

/** Lets the writer's exit be noticed between batches of reads. */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("writeSavedEnv", () => {
  test("a reader polling the file while the host saves it again and again never parses a torn file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "saved-env-"));
    const file = join(dir, "host.json");
    try {
      writeSavedEnv(file, short);
      // Another process saves it the way the host does, alternating a short and a long file, while this one reads.
      const writer = Bun.spawn(
        [
          "bun",
          "-e",
          `const { writeSavedEnv } = await import(${JSON.stringify(join(import.meta.dir, "saved-env.ts"))});
           const [short, long] = ${JSON.stringify([short, long])};
           for (let i = 0; i < ${SAVES}; i++) writeSavedEnv(${JSON.stringify(file)}, i % 2 === 0 ? long : short);`,
        ],
        { stdout: "ignore", stderr: "inherit" },
      );
      let reads = 0;
      const torn: string[] = [];
      while (writer.exitCode === null) {
        for (let i = 0; i < 200; i++) {
          const text = readFileSync(file, "utf8");
          reads += 1;
          try {
            JSON.parse(text);
          } catch {
            torn.push(`${text.length} bytes`);
          }
        }
        // oxlint-disable-next-line no-await-in-loop -- yields so the writer's exit can end the loop
        await turn();
      }
      expect(await writer.exited).toBe(0);
      expect(reads).toBeGreaterThan(0);
      expect(torn).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readSavedEnvIfWhole", () => {
  test("a missing or partly written file is not ready yet; a whole one is read", () => {
    const dir = mkdtempSync(join(tmpdir(), "saved-env-"));
    const file = join(dir, "host.json");
    try {
      expect(readSavedEnvIfWhole(file)).toBeUndefined();
      writeFileSync(file, JSON.stringify(long).slice(0, 40));
      expect(readSavedEnvIfWhole(file)).toBeUndefined();
      writeSavedEnv(file, long);
      expect(readSavedEnvIfWhole(file)).toEqual(long);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
