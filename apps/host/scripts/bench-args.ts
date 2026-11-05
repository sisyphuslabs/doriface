import { parseArgs } from "node:util";
import { MIN_SAMPLES } from "./bench-stats.ts";

export const USAGE = `usage: latency-bench.ts relay --relay <url> --code <code shown by doriface-host pair> [counts]
       latency-bench.ts healthz --relay <url> [counts]
       latency-bench.ts direct [--hc <path>] [counts]

  counts: --calls <n>   measured calls, a whole number of at least ${MIN_SAMPLES} (default 200)
          --warmup <n>  calls made first and left out of the stats, a whole number (default 10)`;

/** A command line the bench refuses; it exits non-zero with the message and the usage. */
export class UsageError extends Error {}

interface Counts {
  readonly calls: number;
  readonly warmup: number;
}

export type BenchArgs =
  | (Counts & { readonly mode: "relay"; readonly relay: string; readonly code: string })
  | (Counts & { readonly mode: "healthz"; readonly relay: string })
  | (Counts & { readonly mode: "direct"; readonly hc: string });

/** A decimal whole number of at least `least`: "abc", "1e3", "2.5", "-1" and "" are refused, not coerced. */
function count(name: string, value: string, least: number): number {
  const n = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(n)) throw new UsageError(`--${name} wants a whole number, got ${JSON.stringify(value)}`);
  if (n < least) throw new UsageError(`--${name} must be at least ${least}, got ${n}`);
  return n;
}

function required(name: string, value: string | undefined, mode: string): string {
  if (value === undefined || value === "") throw new UsageError(`${mode} mode needs --${name}`);
  return value;
}

export function parseBenchArgs(argv: readonly string[]): BenchArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        relay: { type: "string" },
        code: { type: "string" },
        hc: { type: "string", default: "hc" },
        calls: { type: "string", default: "200" },
        warmup: { type: "string", default: "10" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new UsageError("name one mode: relay, healthz or direct");
  const counts = { calls: count("calls", values.calls, MIN_SAMPLES), warmup: count("warmup", values.warmup, 0) };
  const [mode] = positionals;
  if (mode === "relay") {
    return {
      mode,
      relay: required("relay", values.relay, mode),
      code: required("code", values.code, mode),
      ...counts,
    };
  }
  if (mode === "healthz") return { mode, relay: required("relay", values.relay, mode), ...counts };
  if (mode === "direct") return { mode, hc: values.hc, ...counts };
  throw new UsageError(`unknown mode ${JSON.stringify(mode)}: name relay, healthz or direct`);
}
