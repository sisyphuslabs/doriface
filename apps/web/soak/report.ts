/**
 * The soak's results side by side, as Markdown: one column per client, from the soak-result-*.json files in `dir`.
 *
 *   bun soak/report.ts <dir>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Stats {
  readonly count: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly max: number | null;
  readonly lost: number;
}

interface Result {
  readonly client: string;
  readonly userAgent: string;
  readonly minutes: number;
  readonly echo: Stats;
  readonly bursts: Stats & { readonly lines: number };
  readonly sockets: {
    readonly closes: readonly { readonly kind: string; readonly code?: number; readonly atS: number }[];
  };
  readonly reconnects: number;
  readonly pageErrors: readonly string[];
  readonly consoleErrors: { readonly count: number };
}

const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: report.ts <dir>");
const results: Result[] = readdirSync(dir)
  .filter((name) => /^soak-result-.*\.json$/.test(name))
  .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Result);

const ms = (value: number | null): string => (value === null ? "-" : `${value} ms`);
const closes = (result: Result): string =>
  result.sockets.closes.length === 0
    ? "none"
    : result.sockets.closes.map(({ kind, code, atS }) => `${code ?? "?"} on ${kind} at ${atS} s`).join("; ");
const rows: [string, (result: Result) => string][] = [
  ["Minutes", (r) => String(r.minutes)],
  ["Keystrokes measured", (r) => String(r.echo.count)],
  ["Echo p50", (r) => ms(r.echo.p50)],
  ["Echo p95", (r) => ms(r.echo.p95)],
  ["Echo p99", (r) => ms(r.echo.p99)],
  ["Echo max", (r) => ms(r.echo.max)],
  ["Echoes lost (> 10 s)", (r) => String(r.echo.lost)],
  ["Output bursts (lines each)", (r) => `${r.bursts.count} (${r.bursts.lines})`],
  ["Burst p50 / p95", (r) => `${ms(r.bursts.p50)} / ${ms(r.bursts.p95)}`],
  ["Bursts lost (> 60 s)", (r) => String(r.bursts.lost)],
  ["Relay socket closes", closes],
  ["Reconnects", (r) => String(r.reconnects)],
  ["Page errors", (r) => String(r.pageErrors.length)],
  ["Console errors", (r) => String(r.consoleErrors.count)],
];

const lines = [
  `| | ${results.map((r) => r.client).join(" | ")} |`,
  `| --- |${results.map(() => " --- |").join("")}`,
  ...rows.map(([label, cell]) => `| ${label} | ${results.map(cell).join(" | ")} |`),
  "",
  ...results.map((r) => `- ${r.client}: ${r.userAgent}`),
];
console.log(results.length === 0 ? "No soak results." : lines.join("\n"));
