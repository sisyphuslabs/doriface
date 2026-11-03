import { Badge, Button, IconButton, Kbd, SettingRow } from "@doriface/ui";
import { Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { actionFor, type ActionDef } from "../keys/actions.ts";
import type { Keymap } from "../keys/defaults.ts";
import { triggerFromEvent, triggerKeys, type Platform } from "../keys/trigger.ts";

export interface KeybindingRowProps {
  readonly action: ActionDef;
  readonly keymap: Keymap;
  readonly platform: Platform;
  readonly changed: boolean;
  readonly onBind: (trigger: string) => void;
  readonly onUnbind: (trigger: string) => void;
  readonly onReset: () => void;
}

/** Listens for the next key combination; a plain Escape cancels, a modified one is recorded. */
function Recorder({
  onRecord,
  onCancel,
}: {
  readonly onRecord: (trigger: string) => void;
  readonly onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const modified = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
      if (event.key === "Escape" && !modified) return onCancel();
      const trigger = triggerFromEvent(event);
      if (trigger !== null) onRecord(trigger);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onRecord, onCancel]);
  return (
    <span
      role="status"
      className="inline-flex h-(--control) items-center rounded-md border border-ring px-2.5 text-sm text-foreground"
    >
      Press keys…
    </span>
  );
}

export function KeybindingRow({ action, keymap, platform, changed, onBind, onUnbind, onReset }: KeybindingRowProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const triggers = [...keymap].filter(([, bound]) => bound === action.id).map(([trigger]) => trigger);
  const conflict = pending === null ? undefined : keymap.get(pending);
  const conflictLabel = conflict === undefined ? null : (actionFor(conflict)?.label ?? conflict);
  const record = (trigger: string): void => {
    setRecording(false);
    if (keymap.get(trigger) === action.id) return;
    if (keymap.has(trigger)) setPending(trigger);
    else onBind(trigger);
  };
  return (
    <SettingRow
      id={`keybinding-${action.id}`}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {action.label}
          {changed ? <Badge>Changed</Badge> : null}
        </span>
      }
      description={
        pending === null ? (
          <span className="font-mono text-xs">{action.id}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-foreground">
            <Kbd keys={triggerKeys(pending, platform)} /> is {conflictLabel}.
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onBind(pending);
                setPending(null);
              }}
            >
              Replace
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              Keep
            </Button>
          </span>
        )
      }
      control={
        <span className="flex flex-wrap items-center gap-1">
          {triggers.map((trigger) => (
            <span key={trigger} className="inline-flex items-center gap-0.5">
              <Kbd keys={triggerKeys(trigger, platform)} />
              <IconButton
                label={`Remove ${trigger} from ${action.label}`}
                icon={<X />}
                onClick={() => onUnbind(trigger)}
              />
            </span>
          ))}
          {recording ? (
            <Recorder onRecord={record} onCancel={() => setRecording(false)} />
          ) : (
            <IconButton
              label={`Record a shortcut for ${action.label}`}
              icon={<Plus />}
              onClick={() => setRecording(true)}
            />
          )}
          <IconButton
            label={`Reset ${action.label}`}
            icon={<RotateCcw />}
            className={changed ? "" : "invisible"}
            onClick={onReset}
          />
        </span>
      }
    />
  );
}
