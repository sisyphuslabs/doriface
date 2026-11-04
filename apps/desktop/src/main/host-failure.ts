import type { LocalHostFailure } from "../shared/bridge.ts";

/** doriface-host's `startup-error` line (apps/host/src/startup-error.ts): this prefix, then one JSON object. */
const STARTUP_ERROR_PREFIX = "doriface-host startup-error ";
/** Where doriface-host's usage text begins; it is printed only for a command line it refused, and is never shown. */
const USAGE_START = /^usage: doriface-host\b/;

export type StartupReport = Pick<LocalHostFailure, "code" | "message" | "path" | "address">;

const stringField = (value: object, key: string): string | undefined => {
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
};

export function parseStartupError(line: string): StartupReport | undefined {
  if (!line.startsWith(STARTUP_ERROR_PREFIX)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(STARTUP_ERROR_PREFIX.length));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const code = stringField(value, "code");
  const message = stringField(value, "message");
  if (code === undefined || message === undefined) return undefined;
  const path = stringField(value, "path");
  const address = stringField(value, "address");
  return { code, message, ...(path === undefined ? {} : { path }), ...(address === undefined ? {} : { address }) };
}

/** The last `limit` stderr lines a failure shows under Details, with the usage text left out. */
export class StderrTail {
  readonly #lines: string[] = [];
  readonly #limit: number;
  #inUsage = false;
  #report: StartupReport | undefined;

  constructor(limit: number) {
    this.#limit = limit;
  }

  push(line: string): void {
    this.#report = parseStartupError(line) ?? this.#report;
    if (USAGE_START.test(line)) this.#inUsage = true;
    if (this.#inUsage) return;
    this.#lines.push(line);
    if (this.#lines.length > this.#limit) this.#lines.shift();
  }

  get report(): StartupReport | undefined {
    return this.#report;
  }

  text(): string {
    return this.#lines.join("\n").trimEnd();
  }
}
