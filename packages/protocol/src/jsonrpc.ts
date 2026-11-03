import { isJsonObject, parseJson, type JsonObject, type JsonValue } from "./json.ts";

export type JsonRpcId = number | string;

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: JsonValue;
}

export type JsonRpcMessage =
  | {
      readonly kind: "request";
      readonly id: JsonRpcId | null;
      readonly method: string;
      readonly params: JsonValue | undefined;
    }
  | { readonly kind: "notification"; readonly method: string; readonly params: JsonValue | undefined }
  | { readonly kind: "success"; readonly id: JsonRpcId | null; readonly result: JsonValue }
  | { readonly kind: "failure"; readonly id: JsonRpcId | null; readonly error: JsonRpcErrorObject };

export type JsonRpcRequest = Extract<JsonRpcMessage, { readonly kind: "request" }>;
export type JsonRpcNotification = Extract<JsonRpcMessage, { readonly kind: "notification" }>;
export type JsonRpcSuccess = Extract<JsonRpcMessage, { readonly kind: "success" }>;
export type JsonRpcFailure = Extract<JsonRpcMessage, { readonly kind: "failure" }>;
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export class JsonRpcParseError extends Error {
  override readonly name = "JsonRpcParseError";
}

const STANDARD_KINDS: Readonly<Record<number, string>> = {
  [-32700]: "parse_error",
  [-32600]: "invalid_request",
  [-32601]: "unknown_method",
  [-32602]: "invalid_params",
  [-32603]: "internal",
};

/** A JSON-RPC error reply. `kind` is herdr-core's stable `data.kind`; `hint` its suggested fix. */
export class HcRpcError extends Error {
  override readonly name = "HcRpcError";
  readonly code: number;
  readonly kind: string;
  readonly hint: string | undefined;
  readonly data: JsonValue | undefined;

  constructor(error: JsonRpcErrorObject) {
    super(error.message);
    const data = isJsonObject(error.data) ? error.data : undefined;
    const kind = data?.["kind"];
    const hint = data?.["hint"];
    this.code = error.code;
    this.kind = typeof kind === "string" ? kind : (STANDARD_KINDS[error.code] ?? "unknown");
    this.hint = typeof hint === "string" ? hint : undefined;
    this.data = error.data;
  }
}

export function parseJsonRpc(text: string): JsonRpcMessage {
  let value: JsonValue;
  try {
    value = parseJson(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new JsonRpcParseError(`not JSON: ${error.message}`);
    throw error;
  }
  if (!isJsonObject(value)) throw new JsonRpcParseError("a JSON-RPC message must be an object");
  if (value["jsonrpc"] !== "2.0") throw new JsonRpcParseError('missing "jsonrpc": "2.0"');
  return classify(value);
}

const utf8 = new TextDecoder();

export function decodeJsonRpc(bytes: Uint8Array): JsonRpcMessage {
  return parseJsonRpc(utf8.decode(bytes));
}

export function encodeRequest(id: JsonRpcId, method: string, params: object = {}): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

export function encodeNotification(method: string, params: object = {}): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

export function encodeFailure(id: JsonRpcId | null, error: JsonRpcErrorObject): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error });
}

function classify(value: JsonObject): JsonRpcMessage {
  const method = value["method"];
  const id = value["id"];
  if (typeof method === "string") {
    const params = value["params"];
    if (params !== undefined && !Array.isArray(params) && !isJsonObject(params)) {
      throw new JsonRpcParseError("params must be an array or an object");
    }
    if (id === undefined) return { kind: "notification", method, params };
    if (id !== null && !isId(id)) throw new JsonRpcParseError("a request id must be a number, a string or null");
    return { kind: "request", id, method, params };
  }
  if (method !== undefined) throw new JsonRpcParseError("method must be a string");
  if (id !== null && !isId(id)) throw new JsonRpcParseError("a response id must be a number, a string or null");
  const result = value["result"];
  const error = value["error"];
  if (result !== undefined && error === undefined) return { kind: "success", id, result };
  if (error !== undefined && result === undefined) return { kind: "failure", id, error: errorObject(error) };
  throw new JsonRpcParseError("a response needs exactly one of result and error");
}

function errorObject(value: JsonValue): JsonRpcErrorObject {
  if (!isJsonObject(value)) throw new JsonRpcParseError("error must be an object");
  const code = value["code"];
  const message = value["message"];
  const data = value["data"];
  if (typeof code !== "number" || !Number.isInteger(code)) throw new JsonRpcParseError("error.code must be an integer");
  if (typeof message !== "string") throw new JsonRpcParseError("error.message must be a string");
  return data === undefined ? { code, message } : { code, message, data };
}

function isId(value: JsonValue | undefined): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}
