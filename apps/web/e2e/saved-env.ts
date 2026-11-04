import { readFileSync } from "node:fs";

/** A core's hc binary and environment, as the e2e host saved them for the specs, and the host's pid when it saved one. */
export interface SavedEnv {
  readonly hc: string;
  readonly env: Readonly<Record<string, string>>;
  readonly pid?: number;
}

export function readSavedEnv(file: string): SavedEnv {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof value !== "object" || value === null || !("hc" in value) || !("env" in value)) {
    throw new Error(`${file} holds no saved environment`);
  }
  const { hc, env } = value;
  if (typeof hc !== "string" || typeof env !== "object" || env === null) throw new Error(`${file} is malformed`);
  const pid: unknown = Reflect.get(value, "pid");
  const saved = { hc, env: Object.fromEntries(Object.entries(env).map(([key, entry]) => [key, String(entry)])) };
  return typeof pid === "number" ? { ...saved, pid } : saved;
}
