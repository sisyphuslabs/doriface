import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { IconButton } from "./icon-button.tsx";
import { ContextMenu, MenuItem, skipMenuHandler } from "./menu.tsx";
import { StatusIndicator, type AgentStatus } from "./status.tsx";
import { useTabDrag } from "./tab-drag.ts";
import { DropCaret, DropIndicator, placement } from "./tab-drop.tsx";

export interface WorkspaceTab {
  readonly id: string;
  readonly title: string;
  readonly icon?: ReactNode;
  readonly status?: AgentStatus;
  /** The machine it runs on, for a tab that is not on this one: shown after the title and in its tooltip. */
  readonly machine?: string;
  /** The shortcut that focuses this tab's pane, as written on this platform: shown in the tooltip. */
  readonly shortcut?: string;
}

function tooltipOf(tab: WorkspaceTab): string {
  const named = tab.machine === undefined ? tab.title : `${tab.title} on ${tab.machine}`;
  return tab.shortcut === undefined ? named : `${named} (${tab.shortcut})`;
}

/** A tab that moved, by any path (drag, its menu, a key); counted so moving it to the same place again is news. */
export interface TabMoved {
  readonly id: string;
  readonly count: number;
}

export interface TabBarProps {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeId: string;
  readonly onSelect?: (id: string) => void;
  readonly onClose?: (id: string) => void;
  readonly onNew?: () => void;
  /** Moves a tab so it ends at index `to` of `tabs`; without it tabs neither drag nor offer Move in their menu. */
  readonly onMove?: (id: string, to: number) => void;
  /** The New tab shortcut as key chips, from the app's live binding; none when it is unbound. */
  readonly newTabKeys?: readonly string[];
  /** The Move tab left and right shortcuts as key chips, shown in each tab's menu. */
  readonly moveKeys?: { readonly left?: readonly string[]; readonly right?: readonly string[] };
  /** The last move, which the strip announces to screen readers once, as it stood when the tab moved. */
  readonly moved?: TabMoved | null;
  /** Before the tabs, e.g. the button that brings a hidden sidebar back where the sidebar was. */
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
}

/** herdr-app's tab strip: raised pill for the active tab, status glyph instead of colour bars; tabs reorder by drag. */
export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onMove,
  newTabKeys,
  moveKeys,
  moved,
  leading,
  trailing,
  className,
}: TabBarProps) {
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // The tabs the strip drew before its last change of tabs: they carry data-arrived, so the DOM move a reorder makes
  // does not replay their arrival; a tab new to the list draws once without it and arrives.
  const ids = tabs.map((tab) => tab.id);
  const key = ids.join("\n");
  const [drawn, setDrawn] = useState(() => ({ key, before: new Set<string>(), now: new Set(ids) }));
  if (drawn.key !== key) setDrawn({ key, before: drawn.now, now: new Set(ids) });
  // The strip owns a touch's long press: held and moved it drags the tab, held and let go it opens the tab's menu.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const { drag, settle, lifted, touching, onPointerDown, onClickCapture } = useTabDrag(list, ids, {
    onMove,
    onStart: () => setMenuFor(null),
    onHoldRelease: (id, x, y) => {
      const item = list.current?.querySelector(`[data-tab-id="${CSS.escape(id)}"]`);
      item?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
  });

  // Said once per move, as the strip stood then: a later title change or a tab opening or closing does not say it again.
  // The count's parity changes the text each time, so a second move to the same place is still read out.
  const [said, setSaid] = useState({ count: 0, text: "" });
  const last = moved ?? null;
  if (last !== null && last.count !== said.count) {
    const at = tabs.findIndex((tab) => tab.id === last.id);
    const tab = tabs[at];
    const text =
      tab === undefined
        ? ""
        : `Moved ${tab.title} to position ${at + 1} of ${tabs.length}${last.count % 2 === 0 ? "" : "\u00a0"}`;
    setSaid({ count: last.count, text });
  }

  return (
    <div
      data-titlebar
      className={cn(
        "flex h-(--tabbar-height) shrink-0 items-center gap-1 border-b border-border bg-chrome px-2.5",
        className,
      )}
    >
      {leading}
      <div
        ref={list}
        role="tablist"
        aria-label="Tabs"
        onClickCapture={onClickCapture}
        className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {drag === null ? null : <DropIndicator drag={drag} />}
        {drag === null ? null : <DropCaret drag={drag} />}
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const place = placement(tab.id, index, drag, settle);
          const item = (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              {...(drag?.id === tab.id ? { "data-dragging": "" } : {})}
              {...(lifted === tab.id ? { "data-lifted": "" } : {})}
              {...(drawn.before.has(tab.id) ? { "data-arrived": "" } : {})}
              onPointerDown={(event) => onPointerDown(event, tab.id, index)}
              onTouchStart={skipMenuHandler}
              onContextMenu={(event) => {
                if (!touching()) return;
                skipMenuHandler(event);
                event.preventDefault();
              }}
              style={place.offset === 0 ? undefined : { translate: `${place.offset}px 0` }}
              className={cn(
                "group relative motion-arrive flex h-7 max-w-52 shrink-0 items-center gap-2 rounded-md border pr-1 pl-2.5 text-[0.8rem] select-none [--arrive-duration:var(--duration-micro)]",
                active
                  ? "border-border bg-raised text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-hover",
                lifted === tab.id && "border-border bg-raised shadow-overlay hover:bg-raised",
                place.className,
              )}
            >
              <button
                ref={(element) => {
                  if (element === null) buttons.current.delete(tab.id);
                  else buttons.current.set(tab.id, element);
                }}
                type="button"
                role="tab"
                aria-selected={active}
                title={tooltipOf(tab)}
                onClick={() => onSelect?.(tab.id)}
                className="flex min-w-0 items-center gap-2 rounded-xs outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
              >
                {tab.icon}
                <span title={tooltipOf(tab)} className="truncate">
                  {tab.title}
                </span>
                {tab.machine === undefined ? null : (
                  <span title={tab.machine} className="max-w-24 shrink-0 truncate text-2xs text-muted-foreground">
                    {tab.machine}
                  </span>
                )}
                {tab.status === undefined ? null : <StatusIndicator status={tab.status} className="size-3" />}
              </button>
              <IconButton
                label={`Close ${tab.title}`}
                icon={<X />}
                data-tab-close
                onClick={() => onClose?.(tab.id)}
                className={cn(
                  "size-5 [&_svg]:size-3",
                  !active && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              />
            </div>
          );
          if (onMove === undefined) return item;
          return (
            <ContextMenu
              key={tab.id}
              trigger={item}
              finalFocus={{
                get current() {
                  return buttons.current.get(tab.id) ?? null;
                },
              }}
              open={menuFor === tab.id}
              onOpenChange={(open) => setMenuFor(open ? tab.id : null)}
            >
              <MenuItem
                icon={<ArrowLeft />}
                disabled={index === 0}
                {...(moveKeys?.left === undefined ? {} : { keys: moveKeys.left })}
                onClick={() => onMove(tab.id, index - 1)}
              >
                Move tab left
              </MenuItem>
              <MenuItem
                icon={<ArrowRight />}
                disabled={index === tabs.length - 1}
                {...(moveKeys?.right === undefined ? {} : { keys: moveKeys.right })}
                onClick={() => onMove(tab.id, index + 1)}
              >
                Move tab right
              </MenuItem>
            </ContextMenu>
          );
        })}
        <IconButton
          label="New tab"
          {...(newTabKeys === undefined ? {} : { keys: newTabKeys })}
          icon={<Plus />}
          onClick={onNew}
        />
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {said.text}
      </span>
      {trailing}
    </div>
  );
}
