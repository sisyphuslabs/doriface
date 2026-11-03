import { KEY_BY_NAME } from "./keys.ts";

/** Raw Ghostty values per key, exactly as they would appear in a config file. Absent keys use defaults. */
export type TerminalConfig = ReadonlyMap<string, readonly string[]>;

export const EMPTY_CONFIG: TerminalConfig = new Map();

/** The values in force for a key: the user's, else Ghostty's default. */
export function effective(config: TerminalConfig, key: string): readonly string[] {
  return config.get(key) ?? KEY_BY_NAME.get(key)?.defaults ?? [];
}

/** The single value of a non-repeatable key ("" when unset and without a default). */
export function single(config: TerminalConfig, key: string): string {
  return effective(config, key).at(-1) ?? "";
}

export function isDefault(config: TerminalConfig, key: string): boolean {
  return !config.has(key);
}

export function withValues(config: TerminalConfig, key: string, values: readonly string[]): TerminalConfig {
  const next = new Map(config);
  const def = KEY_BY_NAME.get(key);
  const defaults = def?.defaults ?? [];
  // A cleared single-value field is [] from the control and [""] in the schema; both mean "unset".
  const normalized = def?.repeatable === false && values.length === 0 ? [""] : values;
  const same = normalized.length === defaults.length && normalized.every((value, index) => value === defaults[index]);
  if (same) next.delete(key);
  else next.set(key, values);
  return next;
}

export function withoutKey(config: TerminalConfig, key: string): TerminalConfig {
  const next = new Map(config);
  next.delete(key);
  return next;
}
