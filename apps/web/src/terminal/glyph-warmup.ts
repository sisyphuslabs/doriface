/**
 * The first time a page lays out a character its terminal font lacks, the browser asks the system for a fallback face,
 * and on Linux each of those lookups is a fontconfig query of a millisecond or more. A scrollback of distinct CJK
 * characters that output streamed past without drawing paid for all of them in the wheel step that first drew them:
 * seconds in one task (#286). Once the browser has looked a character up at a size, laying it out again is cheap.
 *
 * So every wide character output brings is laid out once in idle time, a few at a time, in a hidden element inside the
 * terminal at the size the renderer will draw it. A wheel step then finds every face it needs already resolved.
 */

/** The smallest wide code point (U+1100, the Hangul Jamo block); its UTF-8 lead byte is 0xE1. */
const FIRST_WIDE = 0x1100;
const FIRST_WIDE_LEAD = 0xe1;
/** Characters laid out per step of a slice: up to about 7 ms each where fallback lookups are slow, so a step stays short. */
const PER_SLICE = 2;
/** Idle time a slice needs left before it starts, so none runs into the next frame. */
const SLICE_MS = 12;

/** Characters already laid out, per font: the browser's fallback cache is per page, shared by every view. */
const warmed = new Map<string, Set<string>>();

interface IdleDeadline {
  timeRemaining(): number;
}
type Schedule = (work: (deadline: IdleDeadline) => void) => void;

const scheduleIdle: Schedule = (work) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(work, { timeout: 1000 });
  else {
    setTimeout(() => {
      const until = performance.now() + SLICE_MS * 2;
      work({ timeRemaining: () => until - performance.now() });
    }, 50);
  }
};

export class GlyphWarmup {
  readonly #element: HTMLElement;
  readonly #scaleOf: () => ((text: string) => number) | null;
  readonly #schedule: Schedule;
  readonly #decoder = new TextDecoder();
  readonly #queue: string[] = [];
  #scheduled = false;
  #stopped = false;

  /** `scaleOf` is the renderer's wide-glyph scale as it is now; `schedule` runs work in idle time. */
  constructor(element: HTMLElement, scaleOf: () => ((text: string) => number) | null, schedule = scheduleIdle) {
    this.#element = element;
    this.#scaleOf = scaleOf;
    this.#schedule = schedule;
  }

  /** Output on its way to the terminal: queues each wide character not yet laid out in this font. */
  note(bytes: Uint8Array): void {
    if (this.#stopped) return;
    // Without a lead byte of a wide character, there is nothing to decode; a split character waits in the decoder.
    if (!bytes.some((byte) => byte >= FIRST_WIDE_LEAD)) {
      this.#decoder.decode(bytes, { stream: true });
      return;
    }
    const done = this.#warmed();
    for (const char of this.#decoder.decode(bytes, { stream: true })) {
      if ((char.codePointAt(0) ?? 0) < FIRST_WIDE || done.has(char)) continue;
      done.add(char);
      this.#queue.push(char);
    }
    this.#wake();
  }

  stop(): void {
    this.#stopped = true;
    this.#queue.length = 0;
    delete this.#element.dataset["glyphWarmup"];
  }

  #warmed(): Set<string> {
    const style = getComputedStyle(this.#element);
    const font = `${style.fontSize} ${style.fontFamily}`;
    let done = warmed.get(font);
    if (done === undefined) {
      done = new Set();
      warmed.set(font, done);
    }
    return done;
  }

  #wake(): void {
    if (this.#queue.length === 0 || this.#scheduled) return;
    this.#scheduled = true;
    // Observable while there is work left: a test waits for it, never for a time.
    this.#element.dataset["glyphWarmup"] = "busy";
    this.#schedule((deadline) => this.#slice(deadline));
  }

  #slice(deadline: IdleDeadline): void {
    this.#scheduled = false;
    if (this.#stopped) return;
    const scale = this.#scaleOf();
    const host = this.#element.ownerDocument.createElement("div");
    // A row and wide cells as the renderer makes them: a bare element lays the text out under other rules, and the
    // lookups it resolves are not the ones a row's wide cells need.
    host.className = "term-row";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;contain:strict;pointer-events:none";
    // Inside the grid, where the rows are: the text is laid out under the same rules as theirs.
    (this.#element.querySelector(".term-grid") ?? this.#element).appendChild(host);
    while (this.#queue.length > 0 && deadline.timeRemaining() > SLICE_MS) {
      const chars = this.#queue.splice(0, PER_SLICE);
      host.replaceChildren(
        ...chars.map((char) => {
          const span = this.#element.ownerDocument.createElement("span");
          span.className = "term-wide";
          const factor = scale?.(char) ?? 1;
          // The size the renderer draws it at: a scaled size is a separate fallback lookup.
          if (factor !== 1) span.style.fontSize = `${factor}em`;
          span.textContent = char;
          return span;
        }),
      );
      // Reading a size lays the characters out now, in this idle slice.
      void host.offsetWidth;
    }
    host.remove();
    if (this.#queue.length > 0) this.#wake();
    else delete this.#element.dataset["glyphWarmup"];
  }
}
