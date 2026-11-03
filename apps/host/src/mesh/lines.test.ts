import { CloseCode } from "@doriface/crypto";
import { memoryLinkPair } from "@doriface/crypto/testing";
import { describe, expect, test } from "bun:test";
import { type LineLink, MAX_LINE_BYTES, MAX_QUEUED_BYTES, MeshLines } from "./lines.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function pair() {
  const [sender, receiver] = memoryLinkPair();
  return { sender, receiver, lines: new MeshLines(receiver, ["done", "refused"]) };
}

describe("mesh stream lines (section 10.2)", () => {
  test("lines split across chunks are read whole, and an unknown type is skipped", async () => {
    const { sender, lines } = pair();
    sender.send(encode('{"t":"future","x":1}\n{"t":"done",'));
    sender.send(encode('"mesh":"m"}\n'));
    expect(await lines.next()).toEqual({ t: "done", mesh: "m" });
  });

  test.each([
    ["not JSON", "nope\n"],
    ["a known type with a bad shape", '{"t":"records","records":[{"body":1}]}\n'],
    ["a line over 256 KiB", `{"t":"refused","reason":"${"x".repeat(MAX_LINE_BYTES)}"}\n`],
  ])("%s closes the session with 4400", async (_, text) => {
    const { sender, receiver, lines } = pair();
    const read = lines.next().then(
      () => "read",
      () => "closed",
    );
    sender.send(encode(text));
    expect(await read).toBe("closed");
    expect(receiver.closeCode).toBe(CloseCode.CryptoFailure);
  });

  test("lines nobody reads close the session with 4400 once they pass 4 MiB, before the line bound", async () => {
    const { sender, receiver, lines } = pair();
    const big = `{"t":"done","mesh":"${"x".repeat(200 * 1024)}"}\n`;
    for (let i = 0; i < 30; i++) sender.send(encode(big));
    await new Promise((resolve) => setImmediate(resolve));
    expect(receiver.closeCode).toBe(CloseCode.CryptoFailure);
    const held = await drain(lines);
    expect(held * 200 * 1024).toBeLessThanOrEqual(MAX_QUEUED_BYTES);
  });

  test("256 KiB without a line feed closes the session with 4400", async () => {
    const { sender, receiver } = pair();
    sender.send(encode(`{"t":"done","mesh":"${"x".repeat(MAX_LINE_BYTES)}`));
    await new Promise((resolve) => setImmediate(resolve));
    expect(receiver.closeCode).toBe(CloseCode.CryptoFailure);
  });

  test("detach stops listening to the session", () => {
    const data = new Set<(bytes: Uint8Array) => void>();
    const closes = new Set<(error: Error | undefined) => void>();
    const link: LineLink = {
      send: () => {},
      onData: (listener) => {
        data.add(listener);
        return () => void data.delete(listener);
      },
      onClose: (listener) => {
        closes.add(listener);
        return () => void closes.delete(listener);
      },
      close: () => {},
    };
    const lines = new MeshLines(link, ["done"]);
    expect([data.size, closes.size]).toEqual([1, 1]);
    lines.detach();
    expect([data.size, closes.size]).toEqual([0, 0]);
  });
});

const drain = (lines: MeshLines, count = 0): Promise<number> =>
  lines.next().then(
    () => drain(lines, count + 1),
    () => count,
  );
