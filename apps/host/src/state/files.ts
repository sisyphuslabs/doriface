import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** $DORIFACE_HOST_STATE_DIR, else $XDG_STATE_HOME/doriface-host, else ~/.local/state/doriface-host. */
export function defaultStateDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const explicit = env["DORIFACE_HOST_STATE_DIR"];
  if (explicit !== undefined && explicit !== "") return explicit;
  const xdg = env["XDG_STATE_HOME"];
  return join(xdg !== undefined && xdg !== "" ? xdg : join(homedir(), ".local", "state"), "doriface-host");
}

/** Creates the state dir owner-only (0700); an existing dir is tightened to 0700 too. */
export function ensureStateDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

const isMissing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";

/** The parsed JSON at `path`, or undefined when the file does not exist. */
export function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  return JSON.parse(text);
}

/** Writes `value` as JSON readable by the owner only (0600), replacing the file atomically. */
export function writePrivateJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Creates `path` with `value` only if it does not exist yet; returns false when another writer got there first. */
export function createPrivateJson(path: string, value: unknown): boolean {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
}

export const removeFile = (path: string): void => rmSync(path, { force: true });

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function stringField(record: Readonly<Record<string, unknown>>, key: string, file: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${file}: ${key} must be a string`);
  return value;
}
