import { useEffect, useState, useSyncExternalStore } from "react";
import { Dictation, type DictationState } from "./dictation.ts";
import { findRecognizer, type Unavailable } from "./recognizer.ts";
import { recognitionLanguage } from "./voice-settings.ts";
import { voiceStore } from "./voice-store.ts";

export interface Voice {
  readonly dictation: Dictation;
  readonly state: DictationState;
  /** Why the mic cannot listen in this browser at all, or null when it can. */
  readonly unavailable: Unavailable | null;
}

/** One dictation for one surface (the phone terminal, the desktop's focused pane); it ends when the surface goes. */
export function useDictation(): Voice {
  const [voice] = useState(() => {
    const support = findRecognizer(window);
    const dictation = new Dictation({
      support,
      language: () => recognitionLanguage(voiceStore.value, navigator.language),
      engine: () => voiceStore.value.engine,
      remember: (engine) => voiceStore.update({ engine }),
    });
    return { dictation, unavailable: support.kind === "unavailable" ? support.why : null };
  });
  const state = useSyncExternalStore(voice.dictation.subscribe, () => voice.dictation.state);
  useEffect(() => () => voice.dictation.close(), [voice]);
  return { ...voice, state };
}
