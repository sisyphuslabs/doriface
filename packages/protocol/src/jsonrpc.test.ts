import { describe, expect, test } from "bun:test";
import {
  decodeJsonRpc,
  encodeRequest,
  HcRpcError,
  JsonRpcParseError,
  parseJsonRpc,
  type JsonRpcMessage,
} from "./jsonrpc.ts";

const failure = (message: JsonRpcMessage) => {
  if (message.kind !== "failure") throw new Error(`expected a failure, got ${message.kind}`);
  return message.error;
};

describe("JSON-RPC parsing", () => {
  test("classifies the four message shapes herdr-core sends", () => {
    expect(parseJsonRpc('{"id":8,"jsonrpc":"2.0","result":{"stopped":true}}')).toEqual({
      kind: "success",
      id: 8,
      result: { stopped: true },
    });
    expect(parseJsonRpc('{"jsonrpc":"2.0","method":"heartbeat","params":{"seq":42}}')).toEqual({
      kind: "notification",
      method: "heartbeat",
      params: { seq: 42 },
    });
    expect(parseJsonRpc('{"jsonrpc":"2.0","id":"r1","method":"terminal.list","params":{}}')).toEqual({
      kind: "request",
      id: "r1",
      method: "terminal.list",
      params: {},
    });
    expect(failure(parseJsonRpc('{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"bad"}}'))).toEqual({
      code: -32700,
      message: "bad",
    });
  });

  test("HcRpcError carries code, kind and hint from data", () => {
    const error = new HcRpcError(
      failure(
        parseJsonRpc(
          '{"jsonrpc":"2.0","id":0,"error":{"code":-32000,"message":"protocol generation 2 not supported",' +
            '"data":{"kind":"unsupported_generation","hint":"this core speaks generation 1"}}}',
        ),
      ),
    );
    expect([error.code, error.kind, error.hint, error.message]).toEqual([
      -32000,
      "unsupported_generation",
      "this core speaks generation 1",
      "protocol generation 2 not supported",
    ]);
  });

  test("HcRpcError falls back to the standard kind for a bare code", () => {
    const error = new HcRpcError({ code: -32601, message: "no such method" });
    expect([error.kind, error.hint]).toEqual(["unknown_method", undefined]);
    expect(new HcRpcError({ code: -32099, message: "?" }).kind).toBe("unknown");
  });

  test.each([
    ["not JSON", "{"],
    ["not an object", "[1]"],
    ["wrong version", '{"jsonrpc":"1.0","id":1,"result":1}'],
    ["fractional id", '{"jsonrpc":"2.0","id":1.5,"method":"x"}'],
    ["both result and error", '{"jsonrpc":"2.0","id":1,"result":1,"error":{"code":1,"message":"m"}}'],
    ["neither result nor error", '{"jsonrpc":"2.0","id":1}'],
    ["error without message", '{"jsonrpc":"2.0","id":1,"error":{"code":1}}'],
  ])("rejects %s", (_name, text) => {
    expect(() => parseJsonRpc(text)).toThrow(JsonRpcParseError);
  });

  test("encodes requests the way hc attach does and decodes bytes", () => {
    const line = encodeRequest(0, "hello", { framed: true });
    expect(line).toBe('{"jsonrpc":"2.0","id":0,"method":"hello","params":{"framed":true}}');
    expect(decodeJsonRpc(new TextEncoder().encode(line))).toMatchObject({ kind: "request", method: "hello" });
  });
});
