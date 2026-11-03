import { CloseCode } from "@doriface/crypto";
import { memoryLinkPair } from "@doriface/crypto/testing";
import { describe, expect, test } from "bun:test";
import { MAX_LINE_BYTES, MeshLines } from "./lines.ts";

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
});
