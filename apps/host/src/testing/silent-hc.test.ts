import { describe, expect, test } from "bun:test";
import { closeSync, constants, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STARTED_FIFO, silentHc } from "./silent-hc.ts";

/** What a connect starting now meets on the FIFO: a reader, or ENXIO when no read is left on it. */
function lateConnect(fifo: string): string {
  try {
    closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK));
    return "a reader";
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
    throw error;
  }
}

describe("the silent hc's FIFO (#1146)", () => {
  test("close ends the read waiting on the FIFO, so no read is left to retry on its closed fd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-silent-close-"));
    const fifo = join(dir, STARTED_FIFO);
    try {
      const silent = silentHc(dir);
      // A connect's start: the reader takes its line and is left waiting on the FIFO for the next one.
      writeFileSync(fifo, "1\n");
      await silent.started(1);
      await silent.close();
      // A read still waiting there would hold the FIFO open, and once a signal or a late connect woke it, it would read
      // again from a fd number that is closed or another file's: the EBADF between tests of #1146.
      expect(lateConnect(fifo)).toBe("ENXIO");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
