import { describe, expect, test } from "bun:test";
import { parseStreamNotification } from "./events.ts";
import { parseJsonRpc, type JsonRpcNotification } from "./jsonrpc.ts";

const notification = (line: string): JsonRpcNotification => {
  const message = parseJsonRpc(line);
  if (message.kind !== "notification") throw new Error(`expected a notification, got ${message.kind}`);
  return message;
};

describe("event stream notifications", () => {
  test("parses the size and finished events hc 0.1.17 sent", () => {
    const size = parseStreamNotification(
      notification(
        '{"jsonrpc":"2.0","method":"event","params":{"data":{"cols":100,"rows":30},"seq":3,"terminal":"t1","type":"size"}}',
      ),
    );
    expect(size).toEqual({
      kind: "event",
      event: { type: "size", seq: 3, terminal: "t1", data: { cols: 100, rows: 30 } },
    });
    const finished = parseStreamNotification(
      notification(
        '{"jsonrpc":"2.0","method":"event","params":{"data":{"exit_code":null,"finished_ms":1,"reason":"killed",' +
          '"signal":1},"seq":5,"terminal":"t1","type":"finished"}}',
      ),
    );
    expect(finished.kind === "event" && finished.event.type === "finished" && finished.event.data.reason).toBe(
      "killed",
    );
  });

  test("parses heartbeat, missed and a foreground event that cleared", () => {
    expect(parseStreamNotification(notification('{"jsonrpc":"2.0","method":"heartbeat","params":{"seq":42}}'))).toEqual(
      {
        kind: "heartbeat",
        seq: 42,
      },
    );
    const missed = parseStreamNotification(
      notification(
        '{"jsonrpc":"2.0","method":"missed","params":{"seq":57,"terminals":[{"address":"t1","labels":{}}]}}',
      ),
    );
    expect(missed.kind === "missed" && missed.snapshot.seq).toBe(57);
    const cleared = parseStreamNotification(
      notification(
        '{"jsonrpc":"2.0","method":"event","params":{"data":null,"seq":9,"terminal":"t1","type":"foreground"}}',
      ),
    );
    expect(cleared.kind === "event" && cleared.event.data).toBeNull();
  });

  test.each([
    ['{"jsonrpc":"2.0","method":"event","params":{"data":{},"seq":1,"type":"teleported"}}'],
    ['{"jsonrpc":"2.0","method":"event","params":{"data":{},"seq":-1,"type":"title"}}'],
    ['{"jsonrpc":"2.0","method":"event","params":{"data":null,"seq":1,"type":"title"}}'],
    ['{"jsonrpc":"2.0","method":"missed","params":{"seq":1,"terminals":[{}]}}'],
    ['{"jsonrpc":"2.0","method":"wobble","params":{}}'],
  ])("passes %s through as unknown", (line) => {
    expect(parseStreamNotification(notification(line)).kind).toBe("unknown");
  });
});
