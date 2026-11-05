import { expect, test } from "bun:test";
import { voiceBlocked } from "./voice-support.ts";

const recognizer = () => class extends EventTarget {};

test("a secure page with a recognizer offers dictation", () => {
  expect(voiceBlocked({ isSecureContext: true, SpeechRecognition: recognizer() })).toBeNull();
  expect(voiceBlocked({ isSecureContext: true, webkitSpeechRecognition: recognizer() })).toBeNull();
});

test("no recognizer, or a page that is not secure, says which", () => {
  expect(voiceBlocked({ isSecureContext: true })).toBe("unsupported");
  expect(voiceBlocked({ isSecureContext: false, SpeechRecognition: recognizer() })).toBe("insecure");
});

test("the desktop app is blocked whole: its Chromium has a recognizer whose speech service refuses it", () => {
  const bridge = { version: "0.1.0", platform: "darwin" };
  expect(voiceBlocked({ isSecureContext: true, SpeechRecognition: recognizer(), doriface: bridge })).toBe("desktop");
  expect(voiceBlocked({ isSecureContext: true, doriface: bridge })).toBe("desktop");
});

test("something on the page that is not the app's bridge is not the desktop app", () => {
  expect(voiceBlocked({ isSecureContext: true, SpeechRecognition: recognizer(), doriface: {} })).toBeNull();
  expect(voiceBlocked({ isSecureContext: true, SpeechRecognition: recognizer(), doriface: "desktop" })).toBeNull();
});
