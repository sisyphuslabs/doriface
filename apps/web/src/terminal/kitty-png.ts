/** A decoded image: straight (not premultiplied) RGBA, row by row. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** Decodes a PNG; null if it is not one, or is too big to hold decoded. */
export type PngDecoder = (png: Uint8Array) => Promise<Rgba | null>;

const ESC = 0x1b;
const APC_INTRODUCER = "_".charCodeAt(0);
const GRAPHICS = "G".charCodeAt(0);
const ST_FINAL = "\\".charCodeAt(0);
const CAN = 0x18;
const SUB = 0x1a;
/** A graphics command longer than this is not held for decoding; it reaches the engine as it is. */
const MAX_COMMAND_BYTES = 64 * 1024 * 1024;
/** Base64 characters per re-sent chunk, a multiple of 4 as the Kitty protocol asks. */
const CHUNK_CHARS = 4096;
/** The Ghostty engine keeps at most this many image bytes per terminal (ghostty/0005's default capacity). */
export const MAX_DECODED_BYTES = 32 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const latin1 = new TextDecoder("latin1");
const ascii = new TextEncoder();

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0] !== undefined) return parts[0];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function toBase64Chunks(bytes: Uint8Array): string[] {
  const chunks: string[] = [];
  const step = (CHUNK_CHARS / 4) * 3;
  for (let at = 0; at < bytes.byteLength; at += step) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(at, at + step))));
  }
  return chunks.length > 0 ? chunks : [""];
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** The width and height a PNG's header declares, or null if it is not a PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.byteLength < 24 || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Decodes a PNG with the browser's own decoder (any bit depth, palette or interlacing it reads). */
export const browserPngDecoder: PngDecoder = async (png) => {
  const size = pngSize(png);
  if (size === null || size.width * size.height * 4 > MAX_DECODED_BYTES) return null;
  try {
    const bitmap = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = context.getImageData(0, 0, width, height);
    return { width, height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch {
    return null;
  }
};

type Keys = Map<string, string>;

function parseKeys(control: string): Keys {
  const keys: Keys = new Map();
  for (const pair of control.split(",")) {
    const equals = pair.indexOf("=");
    if (equals > 0) keys.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
  return keys;
}

/** A command carrying image data the Ghostty engine cannot read: a PNG (f=100) sent directly (t=d). */
function carriesPng(keys: Keys): boolean {
  const action = keys.get("a") ?? "t";
  return keys.get("f") === "100" && (keys.get("t") ?? "d") === "d" && ["T", "t", "q", "f"].includes(action);
}

/** A continuation chunk carries only `m` (and `q`). */
function isContinuation(keys: Keys): boolean {
  return [...keys.keys()].every((key) => key === "m" || key === "q");
}

/** The same command as raw RGBA (f=32) of the decoded size, re-sent in protocol-sized chunks. */
function rgbaCommand(keys: Keys, image: Rgba): Uint8Array {
  const first = new Map(keys);
  first.delete("m");
  first.delete("o");
  first.set("f", "32");
  first.set("s", String(image.width));
  first.set("v", String(image.height));
  const quiet = keys.get("q");
  const chunks = toBase64Chunks(image.rgba);
  const control = (index: number): string => {
    const more = index < chunks.length - 1 ? "1" : "0";
    if (index === 0)
      return [...first.entries(), ...(chunks.length > 1 ? [["m", more]] : [])].map(([k, v]) => `${k}=${v}`).join(",");
    return quiet === undefined ? `m=${more}` : `m=${more},q=${quiet}`;
  };
  return ascii.encode(chunks.map((payload, index) => `\u001b_G${control(index)};${payload}\u001b\\`).join(""));
}

interface HeldPng {
  readonly keys: Keys;
  readonly payloads: string[];
  /** The command's bytes as received, sent on unchanged if they cannot be decoded. */
  readonly raw: Uint8Array[];
  readonly slot: Slot;
}

/** Output in order; `bytes` is null while the command in it is still decoding. */
interface Slot {
  bytes: Uint8Array | null;
}

/**
 * Turns Kitty graphics commands carrying a PNG, which the WebAssembly Ghostty engine refuses ("unsupported format"),
 * into the same commands carrying raw RGBA, which it draws. Everything else passes through unchanged and in order:
 * while a PNG decodes, the output after it waits behind it. See #280.
 */
export class KittyPngTranscoder {
  readonly #write: (bytes: Uint8Array) => void;
  readonly #decode: PngDecoder;
  /** Output waiting behind a decode, in order. */
  #queue: Slot[] = [];
  /** Bytes of an unfinished escape: a graphics command, or the start of one split across writes. */
  #carry: Uint8Array | null = null;
  /** How far into the carried command an earlier write already looked for its end. */
  #scanned = 0;
  #png: HeldPng | null = null;
  #epoch = 0;

  constructor(write: (bytes: Uint8Array) => void, decode: PngDecoder = browserPngDecoder) {
    this.#write = write;
    this.#decode = decode;
  }

  /** Forgets everything held: the stream it came from is gone (an attach replay redraws the screen). */
  reset(): void {
    this.#epoch += 1;
    this.#queue = [];
    this.#carry = null;
    this.#scanned = 0;
    this.#png = null;
  }

  push(input: Uint8Array | string): void {
    const bytes = typeof input === "string" ? ascii.encode(input) : input;
    const data = this.#carry === null ? bytes : concat([this.#carry, bytes]);
    const scanned = this.#scanned;
    this.#carry = null;
    this.#scanned = 0;
    let text = 0;
    let at = 0;
    while (at < data.byteLength) {
      const start = data.indexOf(ESC, at);
      if (start < 0) break;
      if (start + 2 >= data.byteLength) {
        // Possibly the start of a graphics command, split before its introducer is whole.
        const tail = data.subarray(start);
        if (tail.every((byte, index) => byte === [ESC, APC_INTRODUCER, GRAPHICS][index])) {
          this.#emit(data.subarray(text, start));
          this.#carry = tail.slice();
          return;
        }
        break;
      }
      if (data[start + 1] !== APC_INTRODUCER || data[start + 2] !== GRAPHICS) {
        at = start + 1;
        continue;
      }
      const end = this.#commandEnd(data, Math.max(start + 3, start === 0 ? scanned : 0));
      if (end === "open") {
        this.#emit(data.subarray(text, start));
        if (data.byteLength - start > MAX_COMMAND_BYTES) this.#emit(data.subarray(start));
        else {
          this.#carry = data.slice(start);
          this.#scanned = Math.max(3, this.#carry.byteLength - 1);
        }
        return;
      }
      this.#emit(data.subarray(text, start));
      if (end.terminated) this.#command(data.subarray(start, end.at));
      else this.#emit(data.subarray(start, end.at));
      text = at = end.at;
    }
    this.#emit(data.subarray(text));
  }

  /** Where the command from `from` ends: after its ST, or (unterminated) where an ESC or CAN/SUB cuts it off. */
  #commandEnd(data: Uint8Array, from: number): { at: number; terminated: boolean } | "open" {
    for (let at = from; at < data.byteLength; at += 1) {
      const byte = data[at];
      if (byte === CAN || byte === SUB) return { at, terminated: false };
      if (byte !== ESC) continue;
      if (at + 1 >= data.byteLength) return "open";
      return data[at + 1] === ST_FINAL ? { at: at + 2, terminated: true } : { at, terminated: false };
    }
    return "open";
  }

  #command(raw: Uint8Array): void {
    const body = latin1.decode(raw.subarray(3, raw.byteLength - 2));
    const semicolon = body.indexOf(";");
    const keys = parseKeys(semicolon < 0 ? body : body.slice(0, semicolon));
    const payload = semicolon < 0 ? "" : body.slice(semicolon + 1);
    const held = this.#png;
    if (held !== null) {
      if (isContinuation(keys)) {
        held.payloads.push(payload);
        held.raw.push(raw.slice());
        if (keys.get("m") !== "1") this.#finish(held);
        return;
      }
      // A new command before the last chunk: the held one was never whole, so it goes on as it came.
      this.#png = null;
      this.#settle(held.slot, concat(held.raw));
    }
    if (!carriesPng(keys)) {
      this.#emit(raw);
      return;
    }
    const slot: Slot = { bytes: null };
    this.#queue.push(slot);
    const png: HeldPng = { keys, payloads: [payload], raw: [raw.slice()], slot };
    if (keys.get("m") === "1") this.#png = png;
    else this.#finish(png);
  }

  #finish(png: HeldPng): void {
    if (this.#png === png) this.#png = null;
    void this.#settleDecoded(png);
  }

  async #settleDecoded(png: HeldPng): Promise<void> {
    const epoch = this.#epoch;
    const bytes = await this.#transcode(png);
    if (epoch === this.#epoch) this.#settle(png.slot, bytes);
  }

  async #transcode(png: HeldPng): Promise<Uint8Array> {
    const unchanged = concat(png.raw);
    let data = fromBase64(png.payloads.join(""));
    if (data !== null && png.keys.get("o") === "z") data = await inflate(data);
    if (data === null) return unchanged;
    const image = await this.#decode(data);
    return image === null ? unchanged : rgbaCommand(png.keys, image);
  }

  #settle(slot: Slot, bytes: Uint8Array): void {
    slot.bytes = bytes;
    while (this.#queue[0]?.bytes != null) {
      const head = this.#queue.shift();
      if (head?.bytes != null && head.bytes.byteLength > 0) this.#write(head.bytes);
    }
  }

  #emit(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    if (this.#queue.length === 0) this.#write(bytes);
    else this.#queue.push({ bytes: bytes.slice() });
  }
}
