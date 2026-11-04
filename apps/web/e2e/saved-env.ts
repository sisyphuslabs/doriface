import { readFileSync } from "node:fs";

/**
 * A core's hc binary and environment, as the e2e host saved them for the specs, the host's pid when it saved one, and
 * whether the host has finished setting up (its seeds started and its machine added, with that machine's seeds listed).
 */
export interface SavedEnv {
  readonly hc: string;
  readonly env: Readonly<Record<string, string>>;
  readonly pid?: number;
  readonly ready?: boolean;
}

export function readSavedEnv(file: string): SavedEnv {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof value !== "object" || value === null || !("hc" in value) || !("env" in value)) {
    throw new Error(`${file} holds no saved environment`);
  }
  const { hc, env } = value;
  if (typeof hc !== "string" || typeof env !== "object" || env === null) throw new Error(`${file} is malformed`);
  const pid: unknown = Reflect.get(value, "pid");
  const saved = {
    hc,
    env: Object.fromEntries(Object.entries(env).map(([key, entry]) => [key, String(entry)])),
    ...(Reflect.get(value, "ready") === true ? { ready: true } : {}),
  };
  return typeof pid === "number" ? { ...saved, pid } : saved;
}
