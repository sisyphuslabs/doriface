import { findRecognizer, type Unavailable } from "../voice/recognizer.ts";

/** Why this page cannot offer dictation: no recognizer here, an insecure page, or the desktop app. */
export type VoiceBlocked = Unavailable | "desktop";

interface PageScope {
  readonly isSecureContext?: boolean;
  readonly SpeechRecognition?: unknown;
  readonly webkitSpeechRecognition?: unknown;
  readonly doriface?: unknown;
}

const inDesktopShell = (scope: PageScope): boolean =>
  typeof scope.doriface === "object" && scope.doriface !== null && "version" in scope.doriface;

/**
 * Why dictation cannot work on this page, or null where it can. The desktop app's Chromium has a recognizer, but the
 * network speech service refuses it (`not-allowed`) and its on-device path reports unavailable — measured on Electron
 * 45.2.1 / Chromium 156 — so the app is blocked whole rather than offered options that cannot work.
 */
export function voiceBlocked(scope: PageScope): VoiceBlocked | null {
  if (inDesktopShell(scope)) return "desktop";
  const support = findRecognizer(scope);
  return support.kind === "unavailable" ? support.why : null;
}
