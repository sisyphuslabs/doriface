import { useSyncExternalStore } from "react";
import { DEFAULT_VOICE, parseVoiceSettings, VOICE_KEY, type VoiceSettings } from "./voice-settings.ts";

/** The stored voice settings; storage that refuses the read (site settings, a sandbox) gives the defaults. */
function load(): VoiceSettings {
  try {
    return parseVoiceSettings(localStorage.getItem(VOICE_KEY));
  } catch (cause) {
    if (cause instanceof DOMException) return DEFAULT_VOICE;
    throw cause;
  }
}

/** Settings > Voice input, kept beside the other local settings (doriface.layout, doriface.appearance). */
class VoiceStore {
  #value: VoiceSettings = load();
  readonly #listeners = new Set<() => void>();
  get value(): VoiceSettings {
    return this.#value;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  update(patch: Partial<VoiceSettings>): void {
    this.#value = { ...this.#value, ...patch };
    try {
      localStorage.setItem(VOICE_KEY, JSON.stringify(this.#value));
    } catch (cause) {
      // Refused storage keeps the choice for this session only; the app goes on rather than throwing from a click.
      if (!(cause instanceof DOMException)) throw cause;
    }
    for (const listener of this.#listeners) listener();
  }
}

export const voiceStore = new VoiceStore();

export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(voiceStore.subscribe, () => voiceStore.value);
}
