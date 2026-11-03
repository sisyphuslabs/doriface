import { parseThemeFile } from "@doriface/ui";
import { type Appearance, appearanceStore } from "../appearance/appearance.ts";

/** Validates a herdr-app theme file, stores it and selects it. */
export async function importThemeFile(file: File, appearance: Appearance): Promise<void> {
  const json: unknown = JSON.parse(await file.text());
  parseThemeFile(json);
  const name = file.name.replace(/\.json$/i, "");
  const id = `custom:${name}`;
  const custom = [...appearance.custom.filter((entry) => entry.id !== id), { id, name, file: json }];
  appearanceStore.update({ custom, theme: id });
}
