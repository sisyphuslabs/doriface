import { packName } from "../keybar/entries.ts";
import { specialEntries } from "../keybar/entries.ts";
import { setActivePack } from "../keybar/operations.ts";
import { toExtra } from "../keybar/render.tsx";
import type { KeyBarSettings } from "../keybar/settings.ts";
import { keyBarStore } from "../keybar/store.ts";
import type { HostPlatform } from "../terminal/keys.ts";

export interface KeyBarPreviewProps {
  readonly settings: KeyBarSettings;
  readonly host: HostPlatform;
}

/**
 * What Settings > Keyboard is editing: the bar's own row, drawn from the same entries the terminal draws and inert, so a
 * preview can never send anything. The packs the person turned on sit under it as their own row of tabs, the active one
 * pressed, because a pack replaces what leads the terminal's bar.
 */
export function KeyBarPreview({ settings, host }: KeyBarPreviewProps) {
  const keys = specialEntries(settings, host).map(toExtra);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" data-key-bar-preview>
      <p className="px-4 pt-4 pb-2 text-center text-xs text-muted-foreground">
        In the terminal this row rides on your keyboard, and a pack's keys lead it. Command appears where the host is a
        Mac.
      </p>
      <div inert className="flex flex-wrap items-center gap-1.5 border-t border-border bg-chrome px-2 py-2">
        {keys.map((entry) => (
          <span
            key={entry.id}
            data-preview-key={entry.id}
            className="flex h-9 min-w-9 items-center justify-center rounded-full border border-border px-2.5 text-[0.8125rem] font-medium text-foreground [&_svg]:size-4"
          >
            {entry.label}
          </span>
        ))}
        {keys.length === 0 ? <span className="px-2 text-xs text-muted-foreground">No keys in the bar.</span> : null}
      </div>
      {settings.packs.length === 0 ? null : (
        <div
          role="group"
          aria-label="Pack tabs"
          className="flex flex-wrap items-center gap-1.5 border-t border-border px-2 py-2"
        >
          {settings.packs.map((id) => (
            <button
              key={id}
              type="button"
              data-pack-tab={id}
              aria-pressed={settings.activePack === id}
              onClick={() => void keyBarStore.update((current) => setActivePack(current, id))}
              className="h-9 rounded-full border border-border px-3 text-xs font-medium text-foreground outline-none active:bg-selected aria-pressed:bg-selected aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
            >
              {packName(id)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
