import { type KeyboardEvent, useRef } from "react";
import { ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import { IconButton, RowDropCaret, RowDropIndicator, rowPlacement, useListDrag } from "@doriface/ui";
import { specialKeysOn } from "../keybar/catalog.ts";
import { specialEntries } from "../keybar/entries.ts";
import { moveKey, removeKey, restoreKey } from "../keybar/operations.ts";
import { type KeyBarSettings } from "../keybar/settings.ts";
import { keyBarStore } from "../keybar/store.ts";
import type { HostPlatform } from "../terminal/keys.ts";

export interface KeyOrderListProps {
  readonly settings: KeyBarSettings;
  readonly host: HostPlatform;
  readonly readOnly: boolean;
}

const move = (id: string, to: number): void => {
  void keyBarStore.update((current) => moveKey(current, id, to));
};

/** The keys the bar draws, in its order: drag a row or use its arrows to move it, and the X takes it out. */
export function KeyOrderList({ settings, host, readOnly }: KeyOrderListProps) {
  const list = useRef<HTMLUListElement | null>(null);
  const shown = specialEntries(settings, host);
  const ids = shown.map((entry) => entry.id);
  const { drag, settle, onPointerDown, onClickCapture } = useListDrag(list, ids, {
    onMove: readOnly ? undefined : move,
  });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, id: string, index: number): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (!event.altKey) return;
    event.preventDefault();
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < ids.length) move(id, to);
  };
  return (
    <ul ref={list} className="relative flex flex-col">
      {shown.map((entry, index) => {
        const place = rowPlacement(entry.id, index, drag, settle);
        return (
          <li
            key={entry.id}
            data-drag-id={entry.id}
            data-key-row={entry.id}
            style={place.offset === 0 ? undefined : { translate: `0 ${place.offset}px` }}
            onPointerDown={(event) => onPointerDown(event, entry.id, index)}
            onClickCapture={onClickCapture}
            onKeyDown={(event) => onKeyDown(event, entry.id, index)}
            className={`relative flex min-h-11 items-center gap-1 border-b border-border pr-1 last:border-b-0 ${place.className}`}
          >
            <span aria-hidden className="w-6 shrink-0 text-center text-muted-foreground">
              ⠿
            </span>
            <span className="min-w-0 flex-1 truncate text-base text-foreground">{entry.label}</span>
            <span className="min-w-0 shrink-0 pr-1 text-xs text-muted-foreground">{entry.name}</span>
            <IconButton
              data-drag-ignore
              label={`Move ${entry.name} earlier`}
              icon={<ChevronUp />}
              disabled={readOnly || index === 0}
              onClick={() => move(entry.id, index - 1)}
            />
            <IconButton
              data-drag-ignore
              label={`Move ${entry.name} later`}
              icon={<ChevronDown />}
              disabled={readOnly || index === ids.length - 1}
              onClick={() => move(entry.id, index + 1)}
            />
            <IconButton
              data-drag-ignore
              label={`Remove ${entry.name}`}
              icon={<X />}
              disabled={readOnly}
              onClick={() => void keyBarStore.update((current) => removeKey(current, entry.id))}
            />
          </li>
        );
      })}
      {drag === null ? null : <RowDropIndicator drag={drag} />}
      {drag === null ? null : <RowDropCaret drag={drag} />}
      {shown.length === 0 ? (
        <li className="py-3 text-sm text-muted-foreground">The bar has no keys of its own. Add one below.</li>
      ) : null}
    </ul>
  );
}

export interface KeyRestoreListProps {
  readonly settings: KeyBarSettings;
  readonly host: HostPlatform;
  readonly readOnly: boolean;
}

/** The keys that are not in the bar, each with the one tap that puts it back where the list places it. */
export function KeyRestoreList({ settings, host, readOnly }: KeyRestoreListProps) {
  const removed = specialKeysOn(host).filter((entry) => !settings.keys.includes(entry.id));
  if (removed.length === 0) return <p className="py-3 text-sm text-muted-foreground">Every key is in the bar.</p>;
  return (
    <ul className="flex flex-col">
      {removed.map((entry) => (
        <li key={entry.id} className="flex min-h-11 items-center gap-1 border-b border-border pr-1 last:border-b-0">
          <span className="min-w-0 flex-1 truncate text-base text-foreground">{entry.label}</span>
          <span className="min-w-0 shrink-0 pr-1 text-xs text-muted-foreground">{entry.name}</span>
          <IconButton
            label={`Add ${entry.name}`}
            icon={<RotateCcw />}
            disabled={readOnly}
            onClick={() => void keyBarStore.update((current) => restoreKey(current, entry.id))}
          />
        </li>
      ))}
    </ul>
  );
}
