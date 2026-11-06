import { Badge, Button, IconButton, Switch } from "@doriface/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import { packEntries, packName } from "../keybar/entries.ts";
import { addPack, movePack, removePack, setActivePack } from "../keybar/operations.ts";
import { FAVORITES_PACK_ID, PACKS } from "../keybar/packs.ts";
import type { KeyBarSettings } from "../keybar/settings.ts";
import { keyBarStore } from "../keybar/store.ts";

export interface PackListProps {
  readonly settings: KeyBarSettings;
  readonly readOnly: boolean;
}

const ROWS = [
  ...PACKS.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description })),
  {
    id: FAVORITES_PACK_ID,
    name: packName(FAVORITES_PACK_ID),
    description: "Your own keys, the chords this list does not know",
  },
];

/** Every pack as one line: the switch puts it in the bar as a tab, and the arrows order the tabs. */
export function PackList({ settings, readOnly }: PackListProps) {
  return (
    <ul className="flex flex-col">
      {ROWS.map((row) => {
        const on = settings.packs.includes(row.id);
        const index = settings.packs.indexOf(row.id);
        const active = settings.activePack === row.id;
        const count = row.id === FAVORITES_PACK_ID ? settings.favorites.length : packEntries(settings, row.id).length;
        return (
          <li
            key={row.id}
            data-pack-row={row.id}
            className="flex min-h-11 items-center gap-1 border-b border-border py-2 pr-1 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-base text-foreground">
                {row.name}
                {active ? <Badge>In the bar</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {row.description} · {count} {count === 1 ? "key" : "keys"}
              </p>
            </div>
            {on ? (
              <>
                <IconButton
                  label={`Move ${row.name} tab earlier`}
                  icon={<ChevronUp />}
                  disabled={readOnly || index <= 0}
                  onClick={() => void keyBarStore.update((current) => movePack(current, row.id, index - 1))}
                />
                <IconButton
                  label={`Move ${row.name} tab later`}
                  icon={<ChevronDown />}
                  disabled={readOnly || index === settings.packs.length - 1}
                  onClick={() => void keyBarStore.update((current) => movePack(current, row.id, index + 1))}
                />
                {active ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readOnly}
                    onClick={() => void keyBarStore.update((current) => setActivePack(current, row.id))}
                  >
                    Show
                  </Button>
                )}
              </>
            ) : null}
            <Switch
              aria-label={`${on ? "Remove" : "Add"} ${row.name} pack`}
              checked={on}
              disabled={readOnly}
              onCheckedChange={(next: boolean) =>
                void keyBarStore.update((current) => (next ? addPack(current, row.id) : removePack(current, row.id)))
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
