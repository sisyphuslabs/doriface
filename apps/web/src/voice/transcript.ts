/** Every result a continuous session has reported so far: the final words, then the ones still being decided. */
export function transcriptOf(results: unknown): string {
  if (typeof results !== "object" || results === null) return "";
  const length = Number(Reflect.get(results, "length"));
  let final = "";
  let interim = "";
  for (let index = 0; index < length; index += 1) {
    const result: unknown = Reflect.get(results, index);
    if (typeof result !== "object" || result === null) continue;
    const best: unknown = Reflect.get(result, 0);
    const text = typeof best === "object" && best !== null ? Reflect.get(best, "transcript") : undefined;
    if (typeof text !== "string") continue;
    if (Reflect.get(result, "isFinal") === true) final += text;
    else interim += text;
  }
  return final + interim;
}

// A line break would press Return, a tab would complete, and an escape could end a bracketed paste: a transcript is
// typed as one line of plain text, so it can only ever sit at the cursor.
const LINE_BREAKS = /\s*(?:\r\n|[\r\n\u0085\u2028\u2029])\s*/g;
const isControl = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

/** The transcript as the text typed at the terminal's cursor: one line, no control characters, no Return. */
export function toTerminalInput(transcript: string): string {
  const line = transcript.replace(LINE_BREAKS, " ").replace(/\t/g, " ");
  return [...line]
    .filter((character) => !isControl(character))
    .join("")
    .trim();
}
