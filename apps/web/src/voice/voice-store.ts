import { useSyncExternalStore } from "react";
import { parseVoiceSettings, VOICE_KEY, type VoiceSettings } from "./voice-settings.ts";

/** Settings > Voice input, kept beside the other local settings (doriface.layout, doriface.appearance). */
class VoiceStore {
  #value: VoiceSettings = parseVoiceSettings(localStorage.getItem(VOICE_KEY));
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
    localStorage.setItem(VOICE_KEY, JSON.stringify(this.#value));
    for (const listener of this.#listeners) listener();
  }
}

export const voiceStore = new VoiceStore();

export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(voiceStore.subscribe, () => voiceStore.value);
}
