import { $ } from "bun";
import { cpus } from "node:os";

/**
 * Screenshots in a public repository must not show an account name, a host name or an internal run path. Six did, and a
 * reviewer's eye missed five of them for weeks (#926), so the check is mechanical.
 *
 * The checks describe the SHAPE of a leak and never a value: a list of the real fleet names would put them back in the
 * repository that removed them, and a finding names the pattern, never the matched text, because the match is the leak.
 *
 * Known limit: a host name shown as a UI label is caught only where OCR reads the label line as "this machine". At the
 * 768 capture's size it reads a mangled form of it, so that shape is not caught there - which is why the 768 workspace
 * shot stayed out instead of being re-added (#926).
 */
export const NEUTRAL_NAMES: ReadonlySet<string> = new Set([
  "demo",
  "user",
  "me",
  "you",
  "example",
  "project",
  "laptop",
  "box",
  "sandbox",
  "dev",
  "work",
  "localhost",
  "root",
]);

const isNeutral = (name: string): boolean => NEUTRAL_NAMES.has(name.toLowerCase().replace(/^my-/, ""));

const ACCOUNT_AT_HOST = /\b([a-z][a-z0-9._-]*)@([a-z][a-z0-9._-]*)/gi;
const HOME_PATH = /\/(?:Users|home)\/([A-Za-z][A-Za-z0-9._-]*)/g;
const RUN_ROOT = /\/(?:srv|var\/tmp|private\/tmp|var\/folders|tmp)\/[A-Za-z]/;
const OPT_ROOT = /\/opt\/(?!homebrew\b)[A-Za-z]/;
const THIS_MACHINE = /\bthis machine\b/i;
const LABEL_TOKEN = /^[a-z][a-z0-9-]{2,}$/i;

/** The first token of the nearest non-empty line above `index`, stripped of punctuation an ellipsis adds. */
function nearestAbove(lines: readonly string[], index: number): string {
  for (let up = index - 1; up >= 0 && up >= index - 3; up -= 1) {
    const line = (lines[up] ?? "").trim();
    if (line === "") continue;
    return (line.split(/\s+/)[0] ?? "").replace(/[^A-Za-z0-9-]+$/g, "");
  }
  return "";
}

export interface Verdict {
  readonly ok: boolean;
  readonly findings: readonly { readonly pattern: string }[];
}

/** Which shapes a piece of OCR text trips, by name only: the matched text is the leak and is never returned. */
export function classify(ocrText: string): Verdict {
  const findings: { pattern: string }[] = [];
  const add = (pattern: string): void => {
    if (!findings.some((one) => one.pattern === pattern)) findings.push({ pattern });
  };

  for (const match of ocrText.matchAll(ACCOUNT_AT_HOST)) {
    if (isNeutral(match[1] ?? "") && isNeutral(match[2] ?? "")) continue;
    add("prompt: account at host");
  }
  for (const match of ocrText.matchAll(HOME_PATH)) {
    if (!isNeutral(match[1] ?? "")) add("path: home directory");
  }
  if (RUN_ROOT.test(ocrText)) add("path: run root");
  if (OPT_ROOT.test(ocrText)) add("path: system install root");

  const lines = ocrText.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!THIS_MACHINE.test(line)) continue;
    const above = nearestAbove(lines, index);
    if (LABEL_TOKEN.test(above) && !isNeutral(above)) add("label: host name beside this machine");
  }

  return { ok: findings.length === 0, findings };
}

async function ocr(path: string): Promise<string> {
  const result = await $`tesseract ${path} -`
    .env({ ...process.env, OMP_THREAD_LIMIT: "1" })
    .quiet()
    .nothrow();
  if (result.exitCode !== 0) throw new Error(`${path}: tesseract exited ${result.exitCode}`);
  return result.stdout.toString();
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const drain = async (): Promise<void> => {
    const index = next;
    next += 1;
    if (index >= items.length) return;
    out[index] = await run(items[index] as T);
    await drain();
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return out;
}

if (import.meta.main) {
  const images = Bun.argv.slice(2);
  if (images.length === 0) {
    console.error("usage: bun tests/ci/capture-text.ts <image>...");
    process.exit(2);
  }
  const limit = Math.max(1, Math.min(8, cpus().length));
  const verdicts = await mapWithLimit(images, limit, async (image) => ({
    image,
    verdict: classify(await ocr(image)),
  }));
  let failed = 0;
  for (const { image, verdict } of verdicts) {
    if (verdict.ok) continue;
    failed += 1;
    console.error(`${image}: shows internal identifiers (${verdict.findings.map((one) => one.pattern).join(", ")})`);
  }
  if (failed > 0) {
    console.error(`${failed} image(s) must not be committed: re-capture with a neutral name and prompt (#926)`);
    process.exit(1);
  }
}
