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
const SEMICOLON = ";".charCodeAt(0);
const CAN = 0x18;
const SUB = 0x1a;
const INTRODUCER = Uint8Array.of(ESC, APC_INTRODUCER, GRAPHICS);
/** The Ghostty engine keeps at most this many image bytes per terminal (ghostty/0005's default capacity). */
export const MAX_DECODED_BYTES = 32 * 1024 * 1024;
/** A PNG (inflated, if it came compressed) is never bigger than the pixels it may decode to. */
export const MAX_PNG_BYTES = MAX_DECODED_BYTES;
/** The base64 payload of a PNG of MAX_PNG_BYTES, over all its chunks. */
export const MAX_PAYLOAD_BYTES = Math.ceil(MAX_PNG_BYTES / 3) * 4;
/** A graphics command's keys are a few dozen bytes; one whose keys run on is not read. */
const MAX_CONTROL_BYTES = 4096;
/** Base64 characters per re-sent chunk, a multiple of 4 as the Kitty protocol asks. */
const CHUNK_CHARS = 4096;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const latin1 = new TextDecoder("latin1");
const ascii = new TextEncoder();
const NOTHING = new Uint8Array(0);

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

/** Inflates zlib data, giving up (null) once the output would pass `cap` bytes: a small bomb never grows big. */
export async function inflateCapped(bytes: Uint8Array, cap: number): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const parts: Uint8Array[] = [];
  const read = async (size: number): Promise<Uint8Array | null> => {
    const { done, value } = await reader.read();
    if (done) return concat(parts);
    if (size + value.byteLength > cap) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
    return read(size + value.byteLength);
  };
  try {
    return await read(0);
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

const command = (control: string, payload: string): string => `\u001b_G${control};${payload}\u001b\\`;

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
    if (index === 0) {
      const all = [...first.entries(), ...(chunks.length > 1 ? [["m", more]] : [])];
      return all.map(([key, value]) => `${key}=${value}`).join(",");
    }
    return quiet === undefined ? `m=${more}` : `m=${more},q=${quiet}`;
  };
  return ascii.encode(chunks.map((payload, index) => command(control(index), payload)).join(""));
}

/** Output in order; `bytes` is null while the command in it is still decoding. */
interface Slot {
  bytes: Uint8Array | null;
}

/** A PNG transmission being received: its first command's keys, and its payload so far, in parts. */
interface Transmission {
  readonly keys: Keys;
  readonly control: string;
  readonly parts: Uint8Array[];
  size: number;
  readonly slot: Slot;
}

/**
 * Where the transcoder is in a graphics command: reading its keys; holding the payload of a PNG; passing a command it
 * leaves alone straight on; or dropping the rest of one it gave up on.
 */
type Mode = "text" | "control" | "payload" | "pass" | "drop";

/**
 * Turns Kitty graphics commands carrying a PNG, which the WebAssembly Ghostty engine refuses ("unsupported format"),
 * into the same commands carrying raw RGBA, which it draws. See #280.
 *
 * Terminal output is untrusted, so everything held is bounded: other commands stream straight through once their keys
 * are read; a PNG's payload is held only up to MAX_PAYLOAD_BYTES and inflates only up to MAX_PNG_BYTES; and anything
 * other than its next chunk (text included) ends a PNG still arriving in chunks, which is then dropped. Output waits
 * only behind a complete PNG while it decodes, so the image keeps its place.
 */
export class KittyPngTranscoder {
  readonly #write: (bytes: Uint8Array) => void;
  readonly #decode: PngDecoder;
  /** Output waiting behind a decode, in order. */
  #queue: Slot[] = [];
  #mode: Mode = "text";
  /** The start of a graphics command's introducer, split from its end at a write's end. */
  #prefix: Uint8Array = NOTHING;
  /** The command's bytes up to its keys' end, for passing it on unchanged. */
  #head: Uint8Array[] = [];
  #control = "";
  /** The keys of the command whose payload is being held or dropped. */
  #keys: Keys = new Map();
  /** The write ended on an ESC inside a command: the next byte says whether it ended the command. */
  #escape = false;
  /** A PNG still arriving in chunks. */
  #png: Transmission | null = null;
  /** The chunks still to come of a PNG that was dropped are dropped too. */
  #dropping = false;
  #epoch = 0;

  constructor(write: (bytes: Uint8Array) => void, decode: PngDecoder = browserPngDecoder) {
    this.#write = write;
    this.#decode = decode;
  }

  /** Forgets everything held: the stream it came from is gone (an attach replay redraws the screen). */
  reset(): void {
    this.#epoch += 1;
    this.#queue = [];
    this.#mode = "text";
    this.#prefix = NOTHING;
    this.#head = [];
    this.#control = "";
    this.#escape = false;
    this.#png = null;
    this.#dropping = false;
  }

  push(input: Uint8Array | string): void {
    let data = typeof input === "string" ? ascii.encode(input) : input;
    if (data.byteLength === 0) return;
    let at = 0;
    if (this.#escape) {
      this.#escape = false;
      if (data[0] === ST_FINAL) {
        this.#ended(true);
        at = 1;
      } else {
        this.#ended(false);
        this.#prefix = Uint8Array.of(ESC);
      }
    }
    if (this.#prefix.byteLength > 0) {
      data = concat([this.#prefix, data.subarray(at)]);
      at = 0;
      this.#prefix = NOTHING;
    }
    while (at < data.byteLength) at = this.#mode === "text" ? this.#text(data, at) : this.#inCommand(data, at);
  }

  #text(data: Uint8Array, from: number): number {
    for (let at = data.indexOf(ESC, from); at >= 0; at = data.indexOf(ESC, at + 1)) {
      const rest = data.subarray(at, at + 3);
      if (!rest.every((byte, index) => byte === INTRODUCER[index])) continue;
      this.#emitText(data.subarray(from, at));
      if (rest.byteLength < 3) {
        this.#prefix = rest.slice();
        return data.byteLength;
      }
      this.#mode = "control";
      this.#head = [INTRODUCER];
      this.#control = "";
      return at + 3;
    }
    this.#emitText(data.subarray(from));
    return data.byteLength;
  }

  /** Reads a command up to its end or the write's: its keys, then its payload, as its mode says. */
  #inCommand(data: Uint8Array, from: number): number {
    let at = from;
    while (at < data.byteLength) {
      const byte = data[at];
      if (byte === ESC || byte === CAN || byte === SUB) break;
      if (this.#mode === "control" && byte === SEMICOLON) break;
      at += 1;
    }
    this.#take(data.subarray(from, at));
    if (at >= data.byteLength) return at;
    const byte = data[at];
    if (byte === SEMICOLON) {
      if (this.#mode === "control") {
        this.#head.push(data.subarray(at, at + 1).slice());
        this.#keysRead(true);
      } else this.#take(data.subarray(at, at + 1));
      return at + 1;
    }
    if (byte !== ESC) {
      this.#ended(false);
      return at;
    }
    if (at + 1 >= data.byteLength) {
      this.#escape = true;
      return data.byteLength;
    }
    if (data[at + 1] === ST_FINAL) {
      this.#ended(true);
      return at + 2;
    }
    this.#ended(false);
    return at;
  }

  /** The bytes of the current command between its markers, by mode. */
  #take(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    if (this.#mode === "control") {
      this.#head.push(bytes.slice());
      this.#control += latin1.decode(bytes);
      if (this.#control.length > MAX_CONTROL_BYTES) this.#keysRead(false);
    } else if (this.#mode === "pass") this.#emit(bytes);
    else if (this.#mode === "payload") this.#hold(bytes);
  }

  /** The command's keys are read (`whole`), or ran on too long to be: decides what becomes of the command. */
  #keysRead(whole: boolean): void {
    const keys = whole ? parseKeys(this.#control) : new Map<string, string>();
    this.#keys = keys;
    const held = this.#png;
    if (whole && (this.#dropping || held !== null) && isContinuation(keys)) {
      this.#mode = held === null ? "drop" : "payload";
      this.#head = [];
      return;
    }
    this.#interrupt();
    this.#dropping = false;
    if (whole && carriesPng(keys)) {
      const slot: Slot = { bytes: null };
      this.#queue.push(slot);
      this.#png = { keys, control: this.#control, parts: [], size: 0, slot };
      this.#mode = "payload";
      this.#head = [];
      return;
    }
    this.#mode = "pass";
    this.#emit(concat(this.#head));
    this.#head = [];
  }

  #hold(bytes: Uint8Array): void {
    const png = this.#png;
    if (png === null) return;
    png.size += bytes.byteLength;
    if (png.size > MAX_PAYLOAD_BYTES) {
      this.#drop(png);
      this.#mode = "drop";
      return;
    }
    png.parts.push(bytes.slice());
  }

  /** The command ended, with its ST (`terminated`) or cut off by an ESC, CAN or SUB that is not part of it. */
  #ended(terminated: boolean): void {
    const mode = this.#mode;
    this.#mode = "text";
    if (mode === "control") {
      // Keys with no payload: decided like any command, then ended.
      this.#keysRead(true);
      this.#ended(terminated);
      return;
    }
    if (mode === "pass") {
      if (terminated) this.#emit(ascii.encode("\u001b\\"));
      return;
    }
    const more = this.#keys.get("m") === "1";
    if (mode === "drop") {
      this.#dropping = terminated && more;
      return;
    }
    const png = this.#png;
    if (png === null) return;
    if (!terminated) this.#drop(png);
    else if (!more) {
      this.#png = null;
      void this.#settleDecoded(png);
    }
  }

  /** A PNG still arriving in chunks ends when anything but its next chunk arrives: it was never whole, and its late chunks are dropped. */
  #interrupt(): void {
    const png = this.#png;
    if (png === null) return;
    this.#drop(png);
    this.#dropping = true;
  }

  #drop(png: Transmission): void {
    if (this.#png === png) this.#png = null;
    this.#settle(png.slot, NOTHING);
  }

  async #settleDecoded(png: Transmission): Promise<void> {
    const epoch = this.#epoch;
    const bytes = await this.#transcode(png);
    if (epoch === this.#epoch) this.#settle(png.slot, bytes);
  }

  /**
   * The PNG as RGBA; or, if it does not decode, the command unchanged, so the engine still answers it. A compressed one
   * that does not inflate within the cap is dropped instead, so the engine never inflates it either.
   */
  async #transcode(png: Transmission): Promise<Uint8Array> {
    const payload = latin1.decode(concat(png.parts));
    const compressed = png.keys.get("o") === "z";
    let data = fromBase64(payload);
    if (data !== null && compressed) data = await inflateCapped(data, MAX_PNG_BYTES);
    if (data === null) return compressed ? NOTHING : unchanged(png, payload);
    const image = data.byteLength > MAX_PNG_BYTES ? null : await this.#decode(data);
    if (image !== null) return rgbaCommand(png.keys, image);
    return compressed ? NOTHING : unchanged(png, payload);
  }

  #settle(slot: Slot, bytes: Uint8Array): void {
    slot.bytes = bytes;
    while (this.#queue[0]?.bytes != null) {
      const head = this.#queue.shift();
      if (head?.bytes != null && head.bytes.byteLength > 0) this.#write(head.bytes);
    }
  }

  /** Output that is not a graphics command ends a PNG still arriving in chunks, then goes out in order. */
  #emitText(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    this.#interrupt();
    this.#emit(bytes);
  }

  #emit(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    if (this.#queue.length === 0) this.#write(bytes);
    else this.#queue.push({ bytes: bytes.slice() });
  }
}

/** The PNG's command as it came, in one piece: its first keys without `m`, and its whole payload. */
function unchanged(png: Transmission, payload: string): Uint8Array {
  const control = png.control
    .split(",")
    .filter((pair) => !pair.startsWith("m="))
    .join(",");
  return ascii.encode(command(control, payload));
}
