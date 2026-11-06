import type { ExtraKey } from "@doriface/ui";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import type { HostPlatform } from "../terminal/keys.ts";
import type { BarIcon } from "./catalog.ts";
import { activeEntries, type BarEntry, specialEntries } from "./entries.ts";
import type { KeyBarSettings } from "./settings.ts";

const GLYPHS: Readonly<Record<BarIcon, typeof ArrowLeft>> = {
  left: ArrowLeft,
  right: ArrowRight,
  up: ArrowUp,
  down: ArrowDown,
};

export function toExtra(entry: BarEntry): ExtraKey {
  const Glyph = entry.icon === null ? null : GLYPHS[entry.icon];
  const label = Glyph === null ? entry.label : <Glyph aria-hidden />;
  return entry.bytes === null
    ? { id: entry.id, label, name: entry.name, modifier: true }
    : { id: entry.id, label, name: entry.name };
}

/** The two groups the bar draws: the person's own keys, and the active pack's behind a divider. */
export function barGroups(
  settings: KeyBarSettings,
  host: HostPlatform,
): { readonly keys: readonly ExtraKey[]; readonly packKeys: readonly ExtraKey[] } {
  return {
    keys: specialEntries(settings, host).map(toExtra),
    packKeys: activeEntries(settings).map(toExtra),
  };
}
