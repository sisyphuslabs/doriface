import { expect, test } from "bun:test";
import { findRecognizer } from "./recognizer.ts";
import { toTerminalInput } from "./transcript.ts";
import { DEFAULT_VOICE, languageName, parseVoiceSettings, recognitionLanguage } from "./voice-settings.ts";

test("stored voice settings: anything unreadable falls back to the browser's language and asking first", () => {
  for (const raw of [null, "", "{", "[]", "7", '{"language":4,"engine":"cloud"}']) {
    expect(parseVoiceSettings(raw)).toEqual(DEFAULT_VOICE);
  }
  expect(parseVoiceSettings('{"language":"ko-KR","engine":"device"}')).toEqual({ language: "ko-KR", engine: "device" });
  expect(parseVoiceSettings('{"language":"ja-JP","engine":"service"}')).toEqual({
    language: "ja-JP",
    engine: "service",
  });
});

test("the recognition language follows the browser until one is picked", () => {
  expect(recognitionLanguage(DEFAULT_VOICE, "ko-KR")).toBe("ko-KR");
  expect(recognitionLanguage(DEFAULT_VOICE, undefined)).toBe("en-US");
  expect(recognitionLanguage(DEFAULT_VOICE, "")).toBe("en-US");
  expect(recognitionLanguage({ ...DEFAULT_VOICE, language: "ja-JP" }, "ko-KR")).toBe("ja-JP");
});

test("a language reads as words, and an unknown tag as itself", () => {
  expect(languageName("ko-KR")).toBe("Korean (South Korea)");
  expect(languageName("en-US")).toBe("English (United States)");
  expect(languageName("not a tag")).toBe("not a tag");
});

const recognizerClass = () =>
  class extends EventTarget {
    lang = "";
    continuous = false;
    interimResults = false;
    start = () => undefined;
    stop = () => undefined;
    abort = () => undefined;
  };
test("the recognizer is the standard one, else the prefixed one, and only on a secure page", () => {
  const Standard = recognizerClass();
  const Prefixed = recognizerClass();
  expect(
    findRecognizer({ isSecureContext: true, SpeechRecognition: Standard, webkitSpeechRecognition: Prefixed }),
  ).toEqual({ kind: "ok", recognizer: Standard });
  expect(findRecognizer({ isSecureContext: true, webkitSpeechRecognition: Prefixed })).toEqual({
    kind: "ok",
    recognizer: Prefixed,
  });
  expect(findRecognizer({ isSecureContext: true })).toEqual({ kind: "unavailable", why: "unsupported" });
  expect(findRecognizer({ isSecureContext: false, SpeechRecognition: Standard })).toEqual({
    kind: "unavailable",
    why: "insecure",
  });
});

const TYPED = [
  ["echo hi", "echo hi"],
  ["  echo hi  ", "echo hi"],
  ["echo hi\n", "echo hi"],
  ["echo hi\r\nthere", "echo hi there"],
  ["one\n\n  two\rthree\u2028four", "one two three four"],
  ["tab\there", "tab here"],
  ["\u001b[201~escape\u0003\u0004", "[201~escape"],
  ["c1\u0085next\u009b", "c1 next"],
  ["마이그레이션 보여줘. Then test.", "마이그레이션 보여줘. Then test."],
  ["\n\r\t", ""],
] as const;

for (const [spoken, typed] of TYPED) {
  test(`a transcript is typed as one line with no controls: ${JSON.stringify(spoken)}`, () => {
    expect(toTerminalInput(spoken)).toBe(typed);
  });
}
