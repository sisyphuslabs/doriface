import { ExtraKeysBar } from "@doriface/ui";
import { barGroups } from "../keybar/render.tsx";
import type { KeyBarSettings } from "../keybar/settings.ts";
import type { HostPlatform } from "../terminal/keys.ts";

export interface KeyBarPreviewProps {
  readonly settings: KeyBarSettings;
  readonly host: HostPlatform;
}

/** What the bar will look like on the next terminal, drawn in place and inert: a picture, not a second set of keys. */
export function KeyBarPreview({ settings, host }: KeyBarPreviewProps) {
  const { keys, packKeys } = barGroups(settings, host);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex h-20 items-end justify-center px-4 pb-2">
        <p className="text-center text-xs text-muted-foreground">
          In the terminal, this is the row above your keyboard. Command appears where the host is a Mac.
        </p>
      </div>
      <div inert className="border-t border-border" data-key-bar-preview>
        <ExtraKeysBar keys={keys} packKeys={packKeys} className="pb-1" />
      </div>
    </div>
  );
}
