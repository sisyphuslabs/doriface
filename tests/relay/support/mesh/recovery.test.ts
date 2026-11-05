import { expect, test } from "bun:test";
import { DESIGN_RECOVERY_MS, timeRecovery } from "./recovery.ts";

const WARNING = /^::warning title=E-IP restart recovery over the design budget::/;

/** Runs {@link timeRecovery} on a clock that reads 0 when the relay answered and `elapsedMs` once the wait settles. */
async function timed(elapsedMs: number, untilBack: () => Promise<void>) {
  const readings = [0, elapsedMs];
  const printed: string[] = [];
  const settled = await timeRecovery(
    "E-IP restart",
    untilBack,
    () => readings.shift() ?? elapsedMs,
    (line) => {
      printed.push(line);
    },
  ).then(
    () => "back",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  return { settled, printed, warned: printed.filter((line) => WARNING.test(line)).length };
}

test("a recovery within the design budget prints its time and no warning", async () => {
  const run = await timed(DESIGN_RECOVERY_MS, async () => {});
  expect([run.settled, run.printed.length, run.warned]).toEqual(["back", 1, 0]);
  expect(run.printed[0]).toContain(`back ${DESIGN_RECOVERY_MS} ms`);
});

test("a recovery past the design budget still passes, and prints its time and one GitHub Actions warning", async () => {
  const run = await timed(130_000, async () => {});
  expect([run.settled, run.printed.length, run.warned]).toEqual(["back", 2, 1]);
  expect(run.printed[0]).toContain("back 130000 ms");
});

test("lines that never come back still print the time waited, warn, and fail with the wait's own error", async () => {
  const run = await timed(187_326, async () => {
    throw new Error("not connected");
  });
  expect([run.settled, run.printed.length, run.warned]).toEqual(["not connected", 2, 1]);
  expect(run.printed[0]).toContain("not every line was back 187326 ms");
});
