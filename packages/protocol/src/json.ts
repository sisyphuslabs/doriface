export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJson(text: string): JsonValue {
  const value: unknown = JSON.parse(text);
  if (!isJsonValue(value)) throw new TypeError("not a JSON value");
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object":
      return value === null || Array.isArray(value) || isJsonObject(value);
    default:
      return false;
  }
}
