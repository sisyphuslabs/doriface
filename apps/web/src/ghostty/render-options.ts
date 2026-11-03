import { single, type TerminalConfig } from "./config.ts";

export interface RendererOptions {
  /** wterm's cursorBlink: undefined follows what programs ask for. */
  readonly cursorBlink: boolean | undefined;
  /** DECSCUSR written into the local terminal as its default cursor. */
  readonly cursorSequence: string;
  readonly hollowCursor: boolean;
  /** Lines of scrollback for new terminals. */
  readonly scrollbackLines: number;
  readonly copyOnSelect: boolean;
  readonly hideMouseWhileTyping: boolean;
  readonly pasteProtection: boolean;
  readonly confirmClose: "never" | "running" | "always";
}

/** Ghostty sizes scrollback in bytes; libghostty's wasm core counts lines. A row of 200 cells is about 1.6 KB. */
const BYTES_PER_LINE = 1_600;

const SHAPES: Readonly<Record<string, readonly [blinking: number, steady: number]>> = {
  block: [1, 2],
  block_hollow: [1, 2],
  underline: [3, 4],
  bar: [5, 6],
};

export function rendererOptions(config: TerminalConfig): RendererOptions {
  const blink = single(config, "cursor-style-blink");
  const style = single(config, "cursor-style");
  const [blinking, steady] = SHAPES[style] ?? [1, 2];
  const close = single(config, "confirm-close-surface");
  return {
    cursorBlink: blink === "" ? undefined : blink === "true",
    cursorSequence: `\u001b[${blink === "false" ? steady : blinking} q`,
    hollowCursor: style === "block_hollow",
    scrollbackLines: Math.max(100, Math.round(Number(single(config, "scrollback-limit")) / BYTES_PER_LINE)),
    copyOnSelect: single(config, "copy-on-select") !== "false",
    hideMouseWhileTyping: single(config, "mouse-hide-while-typing") === "true",
    pasteProtection: single(config, "clipboard-paste-protection") === "true",
    confirmClose: close === "always" ? "always" : close === "false" ? "never" : "running",
  };
}
