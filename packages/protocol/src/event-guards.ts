import type { Terminal } from "./__generated__/hc-api.ts";
import type { HcEventDataMap, HcEventType } from "./events.ts";
import { isJsonObject, type JsonObject } from "./json.ts";

type DataGuards = { readonly [K in HcEventType]: (data: unknown) => data is HcEventDataMap[K] };

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isNullable =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is T | null =>
    value === null || guard(value);
const isStringMap = (value: unknown): boolean => isJsonObject(value) && Object.values(value).every(isString);

/** Checks the fields the schema marks required on a Terminal record. */
export function isTerminal(value: unknown): value is Terminal {
  return (
    isJsonObject(value) &&
    isString(value["address"]) &&
    isStringMap(value["labels"]) &&
    Array.isArray(value["argv"]) &&
    value["argv"].every(isString) &&
    isString(value["cwd"]) &&
    isString(value["state"]) &&
    isNumber(value["created_ms"]) &&
    isString(value["screen"]) &&
    isNumber(value["cols"]) &&
    isNumber(value["rows"])
  );
}

function hasFields(data: unknown, fields: Readonly<Record<string, (value: unknown) => boolean>>): data is JsonObject {
  return isJsonObject(data) && Object.entries(fields).every(([name, guard]) => guard(data[name]));
}

function fieldsGuard<T>(fields: Readonly<Record<string, (value: unknown) => boolean>>): (data: unknown) => data is T {
  return (data: unknown): data is T => hasFields(data, fields);
}

const ending = fieldsGuard<HcEventDataMap["finished"]>({
  reason: isNullable(isString),
  exit_code: isNullable(isNumber),
  signal: isNullable(isNumber),
  finished_ms: isNullable(isNumber),
});

export const EVENT_DATA_GUARDS: DataGuards = {
  created: isTerminal,
  lost: ending,
  restarted: isTerminal,
  keep: fieldsGuard({ keep: (value) => typeof value === "boolean" }),
  finished: ending,
  removed: (data: unknown): data is HcEventDataMap["removed"] => isJsonObject(data),
  status: fieldsGuard({
    status: (value) => value === null || isJsonObject(value),
    records: isJsonObject,
    reported: (value) => typeof value === "boolean",
  }),
  turn: fieldsGuard({ turn: isNumber, state: isString }),
  title: fieldsGuard({ title: isString }),
  labels: fieldsGuard({ labels: isStringMap, record: (value) => value === undefined || isTerminal(value) }),
  size: fieldsGuard({ cols: isNumber, rows: isNumber }),
  foreground: (data: unknown): data is HcEventDataMap["foreground"] =>
    data === null || hasFields(data, { pid: isNumber, name: isString, argv: Array.isArray, cwd: isString }),
  doc: fieldsGuard({ name: isString, version: isNumber }),
};
