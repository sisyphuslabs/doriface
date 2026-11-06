import { ClipboardPaste, GamepadDirectional, Keyboard, KeyboardOff, List, TextCursorInput } from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn.ts";

export interface ExtraKey {
  readonly id: string;
  readonly label: ReactNode;
  /** Spoken name, e.g. "Escape". */
  readonly name: string;
  /** Sticky one-shot modifiers stay pressed for the next key, then let go. */
  readonly modifier?: boolean;
}

/** A mousedown that would move focus off the terminal would also drop the soft keyboard. */
export function keepFocus(event: MouseEvent): void {
  event.preventDefault();
}

const key =
  "relative flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-1.5 outline-none [&_svg]:size-5 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring";
const latchedKey =
  "bg-primary font-semibold text-primary-foreground after:absolute after:bottom-1.5 after:h-0.5 after:w-3 after:rounded-full after:bg-current active:opacity-80";
const idleKey = "text-foreground active:bg-selected";

/** How long a key is held before the hold counts; a shorter press is the tap it always was. */
const HOLD_MS = 400;

const symbol = (entry: ExtraKey): boolean => typeof entry.label === "string" && entry.label.length === 1;

const divider = (height: string): ReactElement => (
  <span aria-hidden className={cn("mx-1 w-px shrink-0 bg-border", height)} />
);

type Fade = "none" | "start" | "end" | "both";

function fadeOf(el: HTMLElement): Fade {
  const start = el.scrollLeft > 1;
  const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  return start && end ? "both" : start ? "start" : end ? "end" : "none";
}

function useEdgeFade(): [Fade, (el: HTMLDivElement | null) => void] {
  const [fade, setFade] = useState<Fade>("none");
  const node = useRef<HTMLDivElement | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    if (el !== null) setFade(fadeOf(el));
  }, []);
  useEffect(() => {
    const el = node.current;
    if (el === null) return undefined;
    const update = (): void => setFade(fadeOf(el));
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  return [fade, ref];
}

interface KeyButtonProps {
  readonly entry: ExtraKey;
  readonly latched: boolean;
  readonly onKey: ((id: string) => void) | undefined;
  readonly onHold: ((id: string) => void) | undefined;
}

/**
 * One bar key. A held press is its own gesture where the caller names one (Ctrl opens the packs panel); the tap that
 * follows a hold sends nothing, so opening a panel never latches a modifier by accident.
 */
function KeyButton({ entry, latched, onKey, onHold }: KeyButtonProps) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const stop = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const start = (): void => {
    held.current = false;
    if (onHold === undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      held.current = true;
      onHold(entry.id);
    }, HOLD_MS);
  };
  return (
    <button
      type="button"
      aria-label={entry.name}
      aria-pressed={entry.modifier === true ? latched : undefined}
      onMouseDown={keepFocus}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={onHold === undefined ? undefined : (event) => event.preventDefault()}
      onClick={() => {
        if (held.current) {
          held.current = false;
          return;
        }
        onKey?.(entry.id);
      }}
      className={cn(
        key,
        symbol(entry) ? "font-mono text-base" : "text-[0.8125rem] font-medium",
        latched ? latchedKey : idleKey,
      )}
    >
      {entry.label}
    </button>
  );
}

export interface ExtraKeysBarProps {
  /**
   * The person's keys, in their order. Unset where a caller draws only a pack's keys or none — a design mock, or the
   * desktop's keys — so adding the person's own row never breaks a caller that had nothing to put there.
   */
  readonly keys?: readonly ExtraKey[];
  /** The active pack's keys, drawn before the person's own so picking a pack shows its keys at once. */
  readonly packKeys?: readonly ExtraKey[];
  /** Ids of modifiers currently latched. */
  readonly latched?: readonly string[];
  readonly onKey?: (id: string) => void;
  /** A key held down, by id. Ctrl's hold opens the packs panel. */
  readonly onKeyHold?: (id: string) => void;
  readonly padOpen?: boolean;
  readonly onPad?: () => void;
  readonly onPaste?: () => void;
  /**
   * The input field's toggle: a slot of its own, fixed beside the keyboard key so the two never scroll away. Unset
   * where there is no field to open (the desktop's keys never show it).
   */
  readonly inputBox?: boolean;
  readonly onInputBox?: () => void;
  /** A real input field in the first fixed column, in place of the field toggle. */
  readonly inputField?: ReactNode;
  readonly onHideKeyboard?: () => void;
  /** The hide button's name: Hide keyboard by default; Hide keys where the bar shows without a soft keyboard. */
  readonly hideLabel?: string;
  /** Wraps the Switch session button, e.g. in the menu it opens. */
  readonly renderSessions?: (trigger: ReactElement) => ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * The phone's terminal keys, one rounded pill riding on the soft keyboard. Everything that scrolls sits in the row on
 * the left: the active pack's keys, the person's own keys behind a divider, the arrow-pad toggle, Switch session and
 * Paste. The two slots on the right never scroll: the input field and the keyboard's toggle. Every key is
 * a 44 pt target, and pressing one leaves the text focus (and so the keyboard) where it was. A latched modifier inverts
 * to solid ink with a bar under its label, so it reads as on in both themes.
 */
export function ExtraKeysBar(props: ExtraKeysBarProps) {
  const { keys = [], packKeys = [], latched = [], onKey, onKeyHold, padOpen = false, inputBox = false } = props;
  const [fade, scroller] = useEdgeFade();
  const textKey = (entry: ExtraKey) => (
    <KeyButton
      key={entry.id}
      entry={entry}
      latched={latched.includes(entry.id)}
      onKey={onKey}
      onHold={entry.id === "ctrl" ? onKeyHold : undefined}
    />
  );
  const sessions = (
    <button type="button" aria-label="Switch session" onMouseDown={keepFocus} className={cn(key, idleKey)}>
      <List />
    </button>
  );
  return (
    <div
      role="toolbar"
      aria-label="Terminal keys"
      style={props.style}
      className={cn(
        "px-1.5 py-1 transition-[bottom] duration-(--duration-standard) ease-out motion-reduce:transition-none motion-reduce:duration-0",
        props.className,
      )}
    >
      <div className="flex h-[3.25rem] items-center rounded-full border border-border bg-chrome/95 p-1 shadow-lg backdrop-blur-md">
        <div
          ref={scroller}
          data-slot="terminal-keys-scroll"
          data-fade={fade}
          className={cn(
            "flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "data-[fade=end]:[mask-image:linear-gradient(to_right,black_calc(100%-0.75rem),transparent)]",
            "data-[fade=start]:[mask-image:linear-gradient(to_left,black_calc(100%-0.75rem),transparent)]",
            "data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,black_0.75rem,black_calc(100%-0.75rem),transparent)]",
          )}
        >
          {packKeys.map(textKey)}
          {packKeys.length > 0 ? divider("h-5") : null}
          {keys.map(textKey)}
          {divider("h-5")}
          <button
            type="button"
            aria-label="Arrow keys"
            aria-pressed={padOpen}
            onMouseDown={keepFocus}
            onClick={props.onPad}
            className={cn(key, padOpen ? latchedKey : idleKey)}
          >
            <GamepadDirectional />
          </button>
          {props.renderSessions === undefined ? sessions : props.renderSessions(sessions)}
          <button
            type="button"
            aria-label="Paste"
            onMouseDown={keepFocus}
            onClick={props.onPaste}
            className={cn(key, idleKey)}
          >
            <ClipboardPaste />
          </button>
        </div>
        {divider("h-6")}
        <div className="flex shrink-0 items-center">
          {props.inputField ??
            (props.onInputBox === undefined ? null : (
              <button
                type="button"
                aria-label="Type in a field"
                aria-pressed={inputBox}
                onMouseDown={keepFocus}
                onClick={props.onInputBox}
                className={cn(key, inputBox ? latchedKey : idleKey)}
              >
                <TextCursorInput />
              </button>
            ))}
          <button
            type="button"
            aria-label={props.hideLabel ?? "Hide keyboard"}
            onMouseDown={keepFocus}
            onClick={props.onHideKeyboard}
            className={cn(key, idleKey)}
          >
            <KeyboardOff />
          </button>
        </div>
      </div>
    </div>
  );
}

export interface KeyboardButtonProps {
  readonly onPress?: () => void;
  readonly className?: string;
  /** Show keyboard by default; Show keys where the button opens the keys bar itself (no soft keyboard to raise). */
  readonly label?: string;
}

export function KeyboardButton({ onPress, className, label = "Show keyboard" }: KeyboardButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={cn(
        "flex size-12 items-center justify-center rounded-full border border-border bg-chrome/90 text-foreground shadow-lg backdrop-blur-md outline-none active:bg-selected [&_svg]:size-5",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring",
        className,
      )}
    >
      <Keyboard />
    </button>
  );
}
