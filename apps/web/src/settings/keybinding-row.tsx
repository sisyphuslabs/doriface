import { Badge, Button, IconButton, Kbd, SettingRow } from "@doriface/ui";
import { Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { actionFor, displayActionId, type ActionDef } from "../keys/actions.ts";
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
  /** Storage could not be read: nothing can be changed. */
  readonly disabled: boolean;
}

/**
 * Listens for the next key combination; a plain Escape cancels, a modified one is recorded. It takes focus
 * while it listens, so the keyboard user stays at the row instead of on the page body.
 */
function Recorder({
  onRecord,
  onCancel,
}: {
  readonly onRecord: (trigger: string) => void;
  readonly onCancel: () => void;
}) {
  const self = useRef<HTMLSpanElement>(null);
  useEffect(() => self.current?.focus(), []);
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
      ref={self}
      role="status"
      data-captures-keys
      tabIndex={-1}
      className="inline-flex h-(--control) items-center rounded-md border border-ring px-2.5 text-sm text-foreground"
    >
      Press keys…
    </span>
  );
}

export function KeybindingRow({
  action,
  keymap,
  platform,
  changed,
  onBind,
  onUnbind,
  onReset,
  disabled,
}: KeybindingRowProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const recordButton = useRef<HTMLButtonElement>(null);
  // Set when recording or the conflict prompt ends by the keyboard user's choice: focus goes back to the row.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (recording || pending !== null || !returnFocus.current) return;
    returnFocus.current = false;
    // Shown as keyboard focus: Chrome does not count a modified chord (the one just recorded) as keyboard input.
    recordButton.current?.focus({ focusVisible: true });
  }, [recording, pending]);
  const triggers = [...keymap].filter(([, bound]) => bound === action.id).map(([trigger]) => trigger);
  const conflict = pending === null ? undefined : keymap.get(pending);
  const conflictLabel = conflict === undefined ? null : (actionFor(conflict)?.label ?? conflict);
  const finish = (): void => {
    returnFocus.current = true;
    setRecording(false);
  };
  const record = (trigger: string): void => {
    finish();
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
          <span className="font-mono text-xs">{displayActionId(action.id)}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-foreground">
            <Kbd keys={triggerKeys(pending, platform)} persistent /> is {conflictLabel}.
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onBind(pending);
                returnFocus.current = true;
                setPending(null);
              }}
            >
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                returnFocus.current = true;
                setPending(null);
              }}
            >
              Keep
            </Button>
          </span>
        )
      }
      control={
        <span className="flex flex-wrap items-center gap-1">
          {triggers.map((trigger) => (
            <span key={trigger} className="inline-flex items-center gap-0.5">
              <Kbd keys={triggerKeys(trigger, platform)} persistent />
              <IconButton
                label={`Remove ${trigger} from ${action.label}`}
                disabled={disabled}
                icon={<X />}
                onClick={() => onUnbind(trigger)}
              />
            </span>
          ))}
          {recording ? (
            <Recorder onRecord={record} onCancel={finish} />
          ) : (
            <IconButton
              ref={recordButton}
              label={`Record a shortcut for ${action.label}`}
              disabled={disabled}
              icon={<Plus />}
              onClick={() => setRecording(true)}
            />
          )}
          <IconButton
            label={`Reset ${action.label}`}
            disabled={disabled}
            icon={<RotateCcw />}
            className={changed ? "" : "invisible"}
            onClick={onReset}
          />
        </span>
      }
    />
  );
}
