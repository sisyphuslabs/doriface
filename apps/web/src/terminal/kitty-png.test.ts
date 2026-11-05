import { describe, expect, mock, spyOn, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { KittyPngTranscoder, MAX_PAYLOAD_BYTES, MAX_PNG_BYTES, type PngDecoder, type Rgba } from "./kitty-png.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const apc = (control: string, payload = ""): string => `\u001b_G${control};${payload}\u001b\\`;

/** The transcoder's output as text, with a way to wait until it has written something. */
function output(decode: PngDecoder) {
  const written: Uint8Array[] = [];
  const waiting: { matches: (text: string) => boolean; resolve: () => void }[] = [];
  const text = () => Buffer.concat(written).toString("latin1");
  const transcoder = new KittyPngTranscoder((bytes) => {
    written.push(bytes.slice());
    for (const wait of waiting.splice(0)) {
      if (wait.matches(text())) wait.resolve();
      else waiting.push(wait);
    }
  }, decode);
  const until = (matches: (text: string) => boolean) =>
    matches(text()) ? Promise.resolve() : new Promise<void>((resolve) => waiting.push({ matches, resolve }));
  return { transcoder, text, written, until };
}

/** A decoder that answers each PNG with `image` (or null) when the test lets it. */
function heldDecoder(image: Rgba | null) {
  const seen: Uint8Array[] = [];
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  const decode: PngDecoder = async (png) => {
    seen.push(png);
    await released;
    return image;
  };
  return { decode, seen, release };
}

const RED: Rgba = { width: 1, height: 1, rgba: Uint8Array.from([255, 0, 0, 255]) };

describe("Kitty PNG commands become raw RGBA (#280)", () => {
  test("text, other escapes and other graphics commands pass through unchanged and at once", () => {
    const { transcoder, text } = output(async () => RED);
    const inputs = ["plain \u001b[31mred\u001b[0m", "\u001b]0;title\u0007", apc("a=T,f=32,s=1,v=1", b64(RED.rgba))];
    for (const input of inputs) transcoder.push(input);
    expect(text()).toBe(inputs.join(""));
  });

  test("a PNG sent directly is re-sent as RGBA of its decoded size, keeping its keys, and what follows waits for it", async () => {
    const decoder = heldDecoder(RED);
    const { transcoder, text, until } = output(decoder.decode);
    transcoder.push(`before ${apc("a=T,f=100,i=7,q=2", b64(PNG))} after`);
    expect(text()).toBe("before ");
    decoder.release();
    await until((written) => written.endsWith("after"));
    expect(text()).toBe(`before ${apc("a=T,f=32,i=7,q=2,s=1,v=1", b64(RED.rgba))} after`);
    expect([...(decoder.seen[0] ?? [])]).toEqual([...PNG]);
  });

  test("a PNG in chunks, split at any byte, is decoded once whole; a big image is re-sent in chunks", async () => {
    const big: Rgba = { width: 32, height: 32, rgba: new Uint8Array(32 * 32 * 4).fill(9) };
    const decoder = heldDecoder(big);
    const { transcoder, text, until } = output(decoder.decode);
    const payload = b64(PNG);
    const stream = `${apc("a=t,f=100,i=3,m=1", payload.slice(0, 8))}${apc("m=1", payload.slice(8, 12))}${apc("m=0", payload.slice(12))}$ `;
    for (const char of stream) transcoder.push(char);
    decoder.release();
    await until((written) => written.endsWith("$ "));
    const rgba = b64(big.rgba);
    expect(text()).toBe(`${apc("a=t,f=32,i=3,s=32,v=32,m=1", rgba.slice(0, 4096))}${apc("m=0", rgba.slice(4096))}$ `);
    expect(decoder.seen).toHaveLength(1);
  });

  test("a zlib-compressed PNG (o=z) is inflated before it is decoded", async () => {
    const decoder = heldDecoder(RED);
    const { transcoder, text, until } = output(decoder.decode);
    transcoder.push(apc("a=T,f=100,o=z", b64(deflateSync(PNG))));
    decoder.release();
    await until((written) => written.length > 0);
    expect(text()).toBe(apc("a=T,f=32,s=1,v=1", b64(RED.rgba)));
    expect([...(decoder.seen[0] ?? [])]).toEqual([...PNG]);
  });

  test("a PNG that does not decode goes on as it came, so the engine still answers it", async () => {
    const decoder = heldDecoder(null);
    const { transcoder, text, until } = output(decoder.decode);
    const command = apc("a=T,f=100,i=4", b64(PNG));
    transcoder.push(`${command}next`);
    decoder.release();
    await until((written) => written.endsWith("next"));
    expect(text()).toBe(`${command}next`);
  });

  test("a PNG cut off by another escape is dropped, as the engine drops a cut-off command, and what follows comes out", () => {
    const { transcoder, text } = output(async () => RED);
    transcoder.push("\u001b_Ga=T,f=100;abc\u001b[2Jx");
    expect(text()).toBe("\u001b[2Jx");
  });

  test("a zlib bomb is given up on at the cap: the decoder never sees it, nothing is sent for it, and what follows comes out", async () => {
    const decoder = heldDecoder(RED);
    decoder.release();
    const { transcoder, text, until } = output(decoder.decode);
    const bomb = deflateSync(new Uint8Array(MAX_PNG_BYTES + 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    transcoder.push(`${apc("a=T,f=100,o=z", b64(bomb))}after`);
    await until((written) => written.endsWith("after"));
    expect(text()).toBe("after");
    expect(decoder.seen).toEqual([]);
  });

  test("a PNG whose chunks stop coming never holds back the text after it: it is dropped, and so are its late chunks", () => {
    const decoder = heldDecoder(RED);
    const { transcoder, text } = output(decoder.decode);
    transcoder.push(`before ${apc("a=T,f=100,m=1", b64(PNG).slice(0, 8))}`);
    transcoder.push("the prompt comes back");
    expect(text()).toBe("before the prompt comes back");
    transcoder.push(`${apc("m=0", b64(PNG).slice(8))}!`);
    expect(text()).toBe("before the prompt comes back!");
    expect(decoder.seen).toEqual([]);
  });

  test("a PNG past the payload cap is dropped while it arrives, with its later chunks, and the stream flows on", () => {
    const decoder = heldDecoder(RED);
    const { transcoder, text } = output(decoder.decode);
    const chunk = "A".repeat(4 * 1024 * 1024);
    transcoder.push(apc("a=T,f=100,m=1", chunk));
    for (let sent = chunk.length; sent <= MAX_PAYLOAD_BYTES; sent += chunk.length) transcoder.push(apc("m=1", chunk));
    transcoder.push(apc("m=0", chunk));
    transcoder.push("next");
    expect(text()).toBe("next");
    expect(decoder.seen).toEqual([]);
  });

  test("another graphics command streams through as it arrives, not held until its end", () => {
    const { transcoder, written } = output(async () => RED);
    transcoder.push("\u001b_Ga=T,f=32,s=1024,v=1024;AAAA");
    expect(Buffer.concat(written).toString("latin1")).toBe("\u001b_Ga=T,f=32,s=1024,v=1024;AAAA");
  });

  test("a big PNG split into many writes is copied about once, not once per write", () => {
    const stream = Buffer.from(apc("a=T,f=100", "A".repeat(4 * 1024 * 1024)), "latin1");
    const { transcoder } = output(async () => null);
    let copied = 0;
    const { set, slice } = Uint8Array.prototype;
    spyOn(Uint8Array.prototype, "set").mockImplementation(function (this: Uint8Array, source, offset) {
      copied += (source as ArrayLike<number>).length;
      set.call(this, source as ArrayLike<number>, offset);
    });
    spyOn(Uint8Array.prototype, "slice").mockImplementation(function (this: Uint8Array, start, end) {
      const part = slice.call(this, start, end);
      copied += part.length;
      return part;
    });
    for (let at = 0; at < stream.length; at += 16 * 1024) transcoder.push(stream.subarray(at, at + 16 * 1024));
    mock.restore();
    // Re-copying what was carried on every write made this about 128 times the stream for its 256 writes.
    expect(copied).toBeLessThan(stream.length * 4);
  });

  test("a reset forgets what was held behind a decode", async () => {
    const decoder = heldDecoder(RED);
    const { transcoder, text, until } = output(decoder.decode);
    transcoder.push(`${apc("a=T,f=100", b64(PNG))}stale`);
    transcoder.reset();
    transcoder.push("fresh");
    decoder.release();
    await until((written) => written === "fresh");
    // Every microtask the stale decode queued has run once a macrotask comes round.
    await new Promise((resolve) => setImmediate(resolve));
    expect(text()).toBe("fresh");
  });
});
