import {
  encodeRequest,
  HcRpcError,
  isJsonObject,
  JsonRpcParseError,
  LineDecoder,
  parseJson,
  parseJsonRpc,
  type HelloResult,
  type JsonValue,
} from "@doriface/protocol";
import { HcHandshakeError } from "./errors.ts";

const HELLO_ID = 0;
const GENERATION = 1;

/** The exact first bytes `hc attach` sends: a plain-mode JSON line asking for the framed upgrade. */
export const HELLO_REQUEST_LINE = `${encodeRequest(HELLO_ID, "hello", { framed: true })}\n`;

export type HelloStep =
  | { readonly done: false }
  | { readonly done: true; readonly hello: HelloResult; readonly framedBytes: Uint8Array };

/**
 * Reads plain-mode lines until the hello reply. Lines that are not that reply (an ssh banner on
 * a remote `hc connect`) are skipped. Every byte after the reply's LF is already framed.
 */
export class HelloReader {
  readonly #lines = new LineDecoder();

  push(chunk: Uint8Array): HelloStep {
    let input = chunk;
    for (;;) {
      const [line] = this.#lines.push(input, 1);
      input = new Uint8Array(0);
      if (line === undefined) return { done: false };
      const hello = helloFromLine(line);
      if (hello !== undefined) return { done: true, hello, framedBytes: this.#lines.takeBuffered() };
    }
  }
}

function helloFromLine(line: string): HelloResult | undefined {
  if (line.trim() === "") return undefined;
  let message;
  try {
    message = parseJsonRpc(line);
  } catch (error) {
    if (!(error instanceof JsonRpcParseError)) throw error;
    const startup = startupError(line);
    if (startup !== undefined) throw startup;
    return undefined;
  }
  if ((message.kind !== "success" && message.kind !== "failure") || message.id !== HELLO_ID) return undefined;
  if (message.kind === "failure") throw new HcRpcError(message.error);
  const result = message.result;
  const generation = isJsonObject(result) ? result["generation"] : undefined;
  if (generation !== GENERATION) {
    throw new HcHandshakeError(`core speaks protocol generation ${String(generation)}, this client ${GENERATION}`);
  }
  if (!isHelloResult(result)) throw new HcHandshakeError("hello reply is not a HelloResult");
  if (!result.framed) throw new HcHandshakeError("core did not switch to framed mode");
  return result;
}

/** `hc connect` reports its own failures (no core, socket path too long) as `{"error":{kind,message,hint}}`. */
function startupError(line: string): HcRpcError | undefined {
  let value: JsonValue;
  try {
    value = parseJson(line);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  const error = isJsonObject(value) ? value["error"] : undefined;
  if (!isJsonObject(error) || typeof error["message"] !== "string") return undefined;
  return new HcRpcError({ code: -32000, message: error["message"], data: error });
}

function isCoreInfo(value: unknown): boolean {
  return isJsonObject(value) && typeof value["id"] === "string" && typeof value["name"] === "string";
}

function isHelloResult(value: unknown): value is HelloResult {
  if (!isJsonObject(value)) return false;
  const features = value["features"];
  const methods = value["methods"];
  return (
    typeof value["generation"] === "number" &&
    typeof value["version"] === "string" &&
    isCoreInfo(value["core"]) &&
    typeof value["framed"] === "boolean" &&
    Array.isArray(features) &&
    features.every((feature) => typeof feature === "string") &&
    Array.isArray(methods) &&
    methods.every((method) => typeof method === "string")
  );
}
