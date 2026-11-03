import { useEffect, useMemo, useRef } from "react";
import { actionFor, type Scope } from "./actions.ts";
import { resolveKeymap } from "./keymap.ts";
import { useOverrides } from "./keymap-store.ts";
import { currentPlatform, triggerFromEvent } from "./trigger.ts";

/** Returns true when the action ran; false lets the key reach the page. */
export type ActionHandler = (action: string) => boolean;

const handlers: Record<Scope, Set<ActionHandler>> = { app: new Set(), terminal: new Set() };

function dispatch(scope: Scope, action: string): boolean {
  for (const handler of handlers[scope]) if (handler(action)) return true;
  return false;
}

/** Runs a bound action as if its key was pressed; false when no handler took it. */
export function runAction(id: string): boolean {
  const action = actionFor(id);
  return action !== null && dispatch(action.scope, id);
}

export function useActionHandler(scope: Scope, handler: ActionHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const entry: ActionHandler = (action) => latest.current(action);
    handlers[scope].add(entry);
    return () => {
      handlers[scope].delete(entry);
    };
  }, [scope]);
}

function inTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".wterm") !== null;
}

export function useKeymapDispatcher(): void {
  const overrides = useOverrides();
  const keymap = useMemo(() => resolveKeymap(currentPlatform(), overrides), [overrides]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      const trigger = triggerFromEvent(event);
      if (trigger === null) return;
      const id = keymap.get(trigger);
      if (id === undefined) return;
      const action = actionFor(id);
      if (action === null) return;
      if (action.scope === "terminal" && !inTerminal(event.target)) return;
      if (dispatch(action.scope, id)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [keymap]);
}
