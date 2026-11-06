import { Button, IconButton, Input, Notice } from "@doriface/ui";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useState } from "react";
import { MAX_TEXT_BYTES, parseKeyInput } from "../keybar/custom.ts";
import { addFavorite, moveFavorite, removeFavorite } from "../keybar/operations.ts";
import type { KeyBarSettings } from "../keybar/settings.ts";
import { keyBarStore } from "../keybar/store.ts";

export interface FavoriteKeysProps {
  readonly settings: KeyBarSettings;
  readonly readOnly: boolean;
}

/**
 * The person's own keys: a label and what the key sends (a chord such as Ctrl+X, a named key such as F5, or text). The
 * entry is checked before it is stored, and a refused one says why beside the field instead of being kept.
 */
export function FavoriteKeys({ settings, readOnly }: FavoriteKeysProps) {
  const [label, setLabel] = useState("");
  const [keys, setKeys] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = (): void => {
    const name = label.trim();
    if (name === "") {
      setError("Give the key a label, e.g. Interrupt.");
      return;
    }
    const parsed = parseKeyInput(keys);
    if (parsed.kind === "error") {
      setError(parsed.reason);
      return;
    }
    const id = crypto.randomUUID();
    setError(null);
    setLabel("");
    setKeys("");
    void keyBarStore.update((current) => {
      const result = addFavorite(current, { id, label: name, input: keys });
      return result.kind === "added" ? result.settings : current;
    });
  };
  return (
    <div className="flex flex-col gap-3">
      {settings.favorites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No keys of your own yet.</p>
      ) : (
        <ul className="flex flex-col">
          {settings.favorites.map((entry, index) => (
            <li
              key={entry.id}
              data-favorite-row={entry.id}
              className="flex min-h-11 items-center gap-1 border-b border-border pr-1 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-foreground">{entry.label}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{entry.input}</p>
              </div>
              <IconButton
                label={`Move ${entry.label} earlier`}
                icon={<ChevronUp />}
                disabled={readOnly || index === 0}
                onClick={() => void keyBarStore.update((current) => moveFavorite(current, entry.id, index - 1))}
              />
              <IconButton
                label={`Move ${entry.label} later`}
                icon={<ChevronDown />}
                disabled={readOnly || index === settings.favorites.length - 1}
                onClick={() => void keyBarStore.update((current) => moveFavorite(current, entry.id, index + 1))}
              />
              <IconButton
                label={`Remove ${entry.label}`}
                icon={<X />}
                disabled={readOnly}
                onClick={() => void keyBarStore.update((current) => removeFavorite(current, entry.id))}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <h4 className="text-sm font-semibold text-foreground">Add a key</h4>
        <Input
          aria-label="Key label"
          placeholder="Label, e.g. Interrupt"
          value={label}
          disabled={readOnly}
          onValueChange={(next: string) => setLabel(next)}
        />
        <Input
          aria-label="Keys it sends"
          placeholder="Ctrl+X, Alt+Shift+A, F5, PgUp or text"
          value={keys}
          disabled={readOnly}
          className="font-mono"
          onValueChange={(next: string) => setKeys(next)}
        />
        <p className="text-xs text-muted-foreground">
          A chord (Ctrl+X, Alt+Shift+A, Shift+Tab), a named key (F1 to F12, Home, End, PgUp, PgDn, Delete, Esc, Tab,
          Enter) or text up to {MAX_TEXT_BYTES} characters. Nothing here runs as code.
        </p>
        {error === null ? null : (
          <Notice tone="error" title="That key was not added">
            {error}
          </Notice>
        )}
        <Button size="sm" disabled={readOnly} onClick={add} className="self-start">
          <Plus />
          Add key
        </Button>
      </div>
    </div>
  );
}
