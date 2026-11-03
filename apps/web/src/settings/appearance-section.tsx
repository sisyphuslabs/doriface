import { Button, NumberStepper, Notice, SettingRow, Switch, ThemePicker, type ThemeOption } from "@doriface/ui";
import { useRef, useState } from "react";
import { appearanceStore, FONT_SIZE, themeChoices, useAppearance } from "../appearance/appearance.ts";
import { importThemeFile } from "./import-theme.ts";

/** Theme (system, builtins, imported herdr-app themes) and terminal font size. */
export function AppearanceSection() {
  const appearance = useAppearance();
  const picker = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const options: ThemeOption[] = [...themeChoices(appearance)].map(([id, choice]) => ({
    id,
    name: choice.name,
    source: appearance.custom.some((custom) => custom.id === id) ? "herdr-app" : "Built in",
    theme: choice.theme,
  }));

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Follow the system"
        description="Use light or dark to match this device."
        control={
          <span className="flex">
            <Switch
              aria-label="Follow the system theme"
              checked={appearance.theme === "system"}
              onCheckedChange={(checked) => appearanceStore.update({ theme: checked ? "system" : "night" })}
            />
          </span>
        }
      />
      <ThemePicker
        options={options}
        value={appearance.theme}
        onValueChange={(theme) => appearanceStore.update({ theme })}
      />
      <SettingRow
        title="Import a herdr-app theme"
        description="A herdr-app theme file (.json) imports unchanged."
        control={
          <>
            <input
              ref={picker}
              type="file"
              accept="application/json,.json"
              aria-label="Theme file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file === undefined) return;
                importThemeFile(file, appearance).then(
                  () => setImportError(null),
                  (cause: unknown) => setImportError(cause instanceof Error ? cause.message : String(cause)),
                );
              }}
            />
            <Button size="sm" onClick={() => picker.current?.click()}>
              Choose file…
            </Button>
          </>
        }
      />
      {importError === null ? null : (
        <Notice tone="error" title="That theme cannot be used">
          {importError}
        </Notice>
      )}
      <SettingRow
        title="Terminal font size"
        control={
          <NumberStepper
            label="Terminal font size"
            min={FONT_SIZE.min}
            max={FONT_SIZE.max}
            value={appearance.fontSize}
            onValueChange={(fontSize) => {
              if (fontSize !== null) appearanceStore.update({ fontSize });
            }}
          />
        }
      />
    </div>
  );
}
