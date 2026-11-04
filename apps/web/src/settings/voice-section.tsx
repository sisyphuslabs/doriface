import { Button, Menu, MenuItem, SegmentedControl, SettingRow } from "@doriface/ui";
import { Check, ChevronDown } from "lucide-react";
import { findRecognizer } from "../voice/recognizer.ts";
import { type Engine, languageName, VOICE_LANGUAGES } from "../voice/voice-settings.ts";
import { useVoiceSettings, voiceStore } from "../voice/voice-store.ts";

const ENGINES = [
  { value: "ask", label: "Ask first" },
  { value: "device", label: "On this device" },
  { value: "service", label: "Speech service" },
] as const;

const ENGINE_NOTE: Readonly<Record<Engine, string>> = {
  ask: "The first dictation asks before the browser's speech service hears anything.",
  device: "Only the browser's on-device recognizer listens; the audio never leaves this device.",
  service: "The browser sends the audio to its speech service, which may run outside this device.",
};

const UNAVAILABLE = {
  unsupported: "This browser has no speech recognition.",
  insecure: "Dictation needs a secure (https) page.",
} as const;

/** Dictation: the language speech is recognized in, and where it is recognized. Neither keeps any audio. */
export function VoiceSection() {
  const settings = useVoiceSettings();
  const support = findRecognizer(window);
  const browser = navigator.language;
  const name = (tag: string) => (tag === "" ? `Browser language: ${languageName(browser)}` : languageName(tag));
  const listed = VOICE_LANGUAGES.includes(settings.language) || settings.language === "" ? [] : [settings.language];
  const choices = ["", ...VOICE_LANGUAGES, ...listed];
  const reason = support.kind === "unavailable" ? UNAVAILABLE[support.why] : undefined;
  const language = (disabled: boolean) => (
    <Menu
      align="end"
      trigger={
        <Button
          variant="secondary"
          disabled={disabled}
          aria-label={`Language, ${name(settings.language)}`}
          // A long language name gives way inside the row instead of pushing the button past the screen's edge.
          className="max-w-full min-w-0 justify-between [&>span]:max-w-full [&>span]:min-w-0"
        >
          <span className="truncate">{name(settings.language)}</span>
          <ChevronDown aria-hidden />
        </Button>
      }
    >
      {choices.map((tag) => (
        <MenuItem
          key={tag}
          icon={<Check aria-hidden className={tag === settings.language ? "" : "invisible"} />}
          onClick={() => voiceStore.update({ language: tag })}
        >
          {name(tag)}
        </MenuItem>
      ))}
    </Menu>
  );
  const engine = (disabled: boolean) => (
    <SegmentedControl<Engine>
      label="Speech recognition"
      options={ENGINES}
      value={settings.engine}
      disabled={disabled}
      onValueChange={(next) => voiceStore.update({ engine: next })}
    />
  );
  const languageNote = "Speech recognition takes one language at a time.";
  return reason === undefined ? (
    <>
      <SettingRow title="Language" description={languageNote} control={language(false)} />
      <SettingRow title="Speech recognition" description={ENGINE_NOTE[settings.engine]} control={engine(false)} />
    </>
  ) : (
    <>
      <SettingRow title="Language" description={languageNote} disabledReason={reason} control={() => language(true)} />
      <SettingRow
        title="Speech recognition"
        description={ENGINE_NOTE[settings.engine]}
        disabledReason={reason}
        control={() => engine(true)}
      />
    </>
  );
}
