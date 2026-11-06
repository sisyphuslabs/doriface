import { HcConnection, type HcConnection as Connection } from "@doriface/client";
import { ProcessLink } from "@doriface/client/process-link";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The client draws with Ghostty v1.4.0 in wasm; the core lays out its screen with its own libghostty. Every cell the
 * two disagree on shifts the rest of a row in the browser, which is how a comparable client ended up correcting Hangul
 * fillers and conjoining jamo by hand. This pins that both give each of these the same number of cells (#652).
 */
/** Each sample with the cells Ghostty gives it, so a measure that reads 0 everywhere cannot pass as agreement. */
const SAMPLES = [
  ["Hangul syllable 가", "\u{AC00}", 2],
  ["Hangul syllable 한", "\u{D55C}", 2],
  ["compatibility jamo ㄱ", "\u{3131}", 2],
  ["compatibility jamo ㅏ", "\u{314F}", 2],
  ["Hangul filler (compatibility)", "\u{3164}", 0],
  ["choseong filler", "\u{115F}", 0],
  ["jungseong filler", "\u{1160}", 0],
  // A lone conjoining initial joins the next one into a single cluster, so it is measured as initial + medial (ᄀ+ᅡ).
  ["conjoining jamo ᄀ+ᅡ", "\u{1100}\u{1161}", 2],
] as const;

const STEP_MS = 15_000;
const hcBin = process.env["HC_BIN"] ?? Bun.which("hc");
const scratch = await mkdtemp(join(tmpdir(), "dfw-"));
let child: ReturnType<typeof Bun.spawn> | undefined;
let connection: Connection | undefined;

beforeAll(async () => {
  if (hcBin === undefined || hcBin === null) throw new Error("no herdr-core binary: set HC_BIN or put hc on PATH");
  child = Bun.spawn([hcBin, "connect"], {
    cwd: scratch,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: scratch,
      HC_SESSION: `doriface-width-${crypto.randomUUID().slice(0, 8)}`,
      HC_SOCKET: join(scratch, "s.sock"),
      XDG_STATE_HOME: join(scratch, "state"),
      XDG_RUNTIME_DIR: join(scratch, "run"),
      XDG_CONFIG_HOME: join(scratch, "config"),
      DORIFACE_TEST_RUN: process.env["DORIFACE_TEST_RUN"],
    },
  });
  connection = await HcConnection.open(new ProcessLink(child));
});

afterAll(async () => {
  if (connection !== undefined) await connection.call("server.stop", {}, { timeoutMs: STEP_MS }).catch(() => undefined);
  if (child !== undefined && child.exitCode === null) child.kill();
  await child?.exited;
  await rm(scratch, { recursive: true, force: true });
});

const octal = (text: string): string =>
  [...new TextEncoder().encode(text)].map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");

/**
 * The core's own cursor column (1-based) after a program prints `text` on a fresh line: the program asks the core with a
 * cursor position report (ESC [6n), which the core's libghostty answers itself, prints the column and exits. bash, not
 * sh: `read -d` is a bash builtin option, and Linux runners' /bin/sh (dash) has no such option.
 */
async function coreColumnAfter(text: string): Promise<number> {
  if (connection === undefined) throw new Error("no connection");
  const script = `printf '${octal(text)}'; printf '\\033[6n'; IFS= read -r -d R reply; printf '\\nCOL=%s=\\n' "\${reply##*;}"`;
  const run = await connection.call(
    "terminal.run",
    { argv: ["bash", "-c", script], cwd: scratch },
    { timeoutMs: STEP_MS },
  );
  const waited = await connection.call("terminal.wait", { terminal: run.address, timeout: 15 }, { timeoutMs: STEP_MS });
  if (!waited.ended) throw new Error(`the probe for ${JSON.stringify(text)} did not end`);
  const read = await connection.call("terminal.read", { terminal: run.address }, { timeoutMs: STEP_MS });
  const column = /COL=(\d+)=/.exec(read.text)?.[1];
  if (column === undefined) throw new Error(`the core gave no cursor report for ${JSON.stringify(text)}: ${read.text}`);
  return Number(column);
}

/** Cells the core gives one `char`, read as how far it moves the cursor between two letters. */
async function coreCells(char: string): Promise<number> {
  return (await coreColumnAfter(`A${char}Z`)) - (await coreColumnAfter("AZ"));
}

/** The client's wasm core: where its cursor stands after it prints `text` on a fresh terminal. */
async function clientColumnAfter(text: string): Promise<number> {
  const wasm = await Bun.file(
    new URL("../../../../packages/ghostty-wasm/wasm/ghostty-vt.wasm", import.meta.url),
  ).bytes();
  const { instance } = await WebAssembly.instantiate(wasm, { env: { log: () => undefined } });
  const exports = instance.exports;
  const call = (name: string, ...args: number[]): number => {
    const fn = exports[name];
    if (typeof fn !== "function") throw new Error(`ghostty-vt.wasm has no export ${name}`);
    return Number(fn(...args));
  };
  const memory = exports["memory"];
  if (!(memory instanceof WebAssembly.Memory)) throw new Error("ghostty-vt.wasm exports no memory");
  const term = call("init", 80, 24, 1_000, 0xffffff, 0, 0);
  try {
    const bytes = new TextEncoder().encode(text);
    const buffer = call("alloc_buffer", bytes.byteLength);
    new Uint8Array(memory.buffer, buffer, bytes.byteLength).set(bytes);
    call("write", term, buffer, bytes.byteLength);
    call("free_buffer", buffer, bytes.byteLength);
    // The cursor the getters read is the one the last update published.
    call("update", term);
    return call("get_cursor_col", term);
  } finally {
    call("deinit", term);
  }
}

/**
 * Cells the client gives one `char`. Ghostty may hold the last printed codepoint until the next one decides where its
 * grapheme ends, so both runs end in the same letter and only the difference is read.
 */
async function clientCells(char: string): Promise<number> {
  return (await clientColumnAfter(`A${char}Z`)) - (await clientColumnAfter("AZ"));
}

describe("Hangul cells: the client's Ghostty and the core's agree (#652)", () => {
  test("a plain letter is one cell on both, so the measure works", async () => {
    expect(await clientCells("A")).toBe(1);
    expect(await coreCells("A")).toBe(1);
  }, 60_000);

  test.each(SAMPLES)(
    "%s takes the same cells on the client and the core",
    async (_name, char, cells) => {
      const code = char.codePointAt(0)?.toString(16);
      const measured = { code, client: await clientCells(char), core: await coreCells(char) };
      expect(measured).toEqual({ code, client: cells, core: cells });
    },
    60_000,
  );
});
