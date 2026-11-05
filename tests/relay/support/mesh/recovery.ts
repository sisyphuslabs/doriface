/**
 * Design 8.2: after a relay restart every line is back within 120 s, counted from the moment the relay answers again.
 * A test's own bound sits above it so a slow runner still passes; a recovery past it is reported, never failed.
 */
export const DESIGN_RECOVERY_MS = 120_000;

/**
 * The lines that report a recovery `elapsedMs` after the relay answered: whether every line was `back` in that time,
 * against the design's budget, and a GitHub Actions warning when it took longer than the budget, so drift shows in CI.
 */
export function recoveryLines(label: string, elapsedMs: number, back: boolean): readonly string[] {
  const elapsed = Math.round(elapsedMs);
  const outcome = back
    ? `every line was back ${elapsed} ms after that`
    : `not every line was back ${elapsed} ms after that`;
  const line = `${label}: ${outcome} (design 8.2 budget ${DESIGN_RECOVERY_MS} ms)`;
  if (elapsed <= DESIGN_RECOVERY_MS) return [line];
  return [line, `::warning title=${label} recovery over the design budget::${line}`];
}

/**
 * Awaits `untilBack` and prints {@link recoveryLines} for the time it took, whether the lines came back or not: a
 * rejection still prints, then propagates.
 */
export async function timeRecovery(
  label: string,
  untilBack: () => Promise<void>,
  clock: () => number = () => performance.now(),
  print: (line: string) => void = console.log,
): Promise<void> {
  const answered = clock();
  let back = false;
  try {
    await untilBack();
    back = true;
  } finally {
    for (const line of recoveryLines(label, clock() - answered, back)) print(line);
  }
}
