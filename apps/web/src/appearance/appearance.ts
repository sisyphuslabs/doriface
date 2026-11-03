import { BUILTIN_PALETTES, parseThemeFile, resolveTheme, themeVariables, type ResolvedTheme } from "@doriface/ui";
import { useSyncExternalStore } from "react";

export interface CustomTheme {
  readonly id: string;
  readonly name: string;
  /** The herdr-app theme file as imported, so it re-resolves with newer rules. */
  readonly file: unknown;
}

export interface Appearance {
  /** "system", a builtin palette name, or a custom theme id. */
  readonly theme: string;
  readonly fontSize: number;
  readonly custom: readonly CustomTheme[];
}

export const FONT_SIZE = { min: 10, max: 24, initial: 14 } as const;
const KEY = "doriface.appearance";
const DEFAULT: Appearance = { theme: "system", fontSize: FONT_SIZE.initial, custom: [] };

function isCustomTheme(value: unknown): value is CustomTheme {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "name") === "string"
  );
}

function load(): Appearance {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return DEFAULT;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT;
  const theme: unknown = Reflect.get(parsed, "theme");
  const fontSize: unknown = Reflect.get(parsed, "fontSize");
  const custom: unknown = Reflect.get(parsed, "custom");
  return {
    theme: typeof theme === "string" ? theme : DEFAULT.theme,
    fontSize:
      typeof fontSize === "number" && fontSize >= FONT_SIZE.min && fontSize <= FONT_SIZE.max
        ? fontSize
        : DEFAULT.fontSize,
    custom: Array.isArray(custom) ? custom.filter(isCustomTheme) : [],
  };
}

/** Every selectable theme resolved; custom files that no longer parse are skipped. */
export function themeChoices(appearance: Appearance): ReadonlyMap<string, { name: string; theme: ResolvedTheme }> {
  const choices = new Map<string, { name: string; theme: ResolvedTheme }>();
  for (const [id, palette] of Object.entries(BUILTIN_PALETTES)) {
    choices.set(id, { name: id[0]?.toUpperCase() + id.slice(1), theme: resolveTheme(palette) });
  }
  for (const custom of appearance.custom) {
    try {
      choices.set(custom.id, { name: custom.name, theme: resolveTheme(parseThemeFile(custom.file)) });
    } catch {
      continue;
    }
  }
  return choices;
}

/** Writes the chosen theme's variables onto <html>; "system" leaves the stylesheet's own media queries. */
export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement): void {
  for (const name of Array.from(root.style)) if (name.startsWith("--")) root.style.removeProperty(name);
  root.style.removeProperty("color-scheme");
  root.style.setProperty("--term-font-size", `${appearance.fontSize}px`);
  const choice = themeChoices(appearance).get(appearance.theme);
  if (choice === undefined) return;
  for (const [name, value] of Object.entries(themeVariables(choice.theme))) root.style.setProperty(`--${name}`, value);
  root.style.setProperty("color-scheme", choice.theme.light ? "light" : "dark");
}

class AppearanceStore {
  #value = load();
  #listeners = new Set<() => void>();
  get value(): Appearance {
    return this.#value;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  update(patch: Partial<Appearance>): void {
    this.#value = { ...this.#value, ...patch };
    localStorage.setItem(KEY, JSON.stringify(this.#value));
    applyAppearance(this.#value);
    for (const listener of this.#listeners) listener();
  }
}

export const appearanceStore = new AppearanceStore();

export function useAppearance(): Appearance {
  return useSyncExternalStore(appearanceStore.subscribe, () => appearanceStore.value);
}
