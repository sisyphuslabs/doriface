import { COLOR_KEYS, CURSOR_KEYS } from "./keys-cursor-colors.ts";
import { FONT_KEYS } from "./keys-font.ts";
import { BEHAVIOR_KEYS, SPACING_KEYS } from "./keys-spacing-behavior.ts";
import type { KeyDef } from "./schema.ts";

/** Every terminal setting, in display order: the one source of truth for the UI, parser and renderer. */
export const KEYS: readonly KeyDef[] = [...FONT_KEYS, ...CURSOR_KEYS, ...COLOR_KEYS, ...SPACING_KEYS, ...BEHAVIOR_KEYS];

export const KEY_BY_NAME: ReadonlyMap<string, KeyDef> = new Map(KEYS.map((def) => [def.key, def]));
