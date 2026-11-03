/** An engine's error message as a sentence that can follow ours: trimmed and ending in punctuation. */
export function asSentence(message: string): string {
  const text = message.trim();
  return text === "" || /[.!?]$/.test(text) ? text : `${text}.`;
}
