import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** Pointer travel before a press becomes a drag; less is still a click that selects. */
export const DRAG_THRESHOLD_PX = 4;
/** On touch a swipe scrolls the strip; a press held this long lifts the tab instead. */
export const TOUCH_HOLD_MS = 300;
const TOUCH_SLOP_PX = 8;
/** Within this distance of an end of an overflowing strip the strip scrolls under the dragged tab. */
const EDGE_PX = 32;
const EDGE_STEP_PX = 8;
const SETTLE_MS = 200;

interface Slot {
  readonly left: number;
  readonly width: number;
}

interface Press {
  readonly id: string;
  readonly from: number;
  readonly pointerId: number;
  readonly touch: boolean;
  readonly startX: number;
  readonly startY: number;
  armed: boolean;
  clientX: number;
  dragging: { readonly slots: readonly Slot[]; readonly gap: number; readonly startScroll: number } | null;
}

/** A drag in progress: `to` is the index the tab lands at, `offset` how far it is from its own slot. */
export interface DragState {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly offset: number;
  readonly slots: readonly Slot[];
  readonly gap: number;
}

/** The dropped (or cancelled) tab easing from where it was let go into its slot. */
export interface Settle {
  readonly id: string;
  readonly offset: number;
  readonly running: boolean;
}

/** The index the dragged tab lands at: past every other tab whose centre its own centre has crossed. */
export function landingIndex(slots: readonly Slot[], from: number, offset: number): number {
  const dragged = slots[from];
  if (dragged === undefined) return from;
  const centre = dragged.left + dragged.width / 2 + offset;
  return slots.filter((slot, index) => index !== from && slot.left + slot.width / 2 < centre).length;
}

/** How far a tab that is not dragged slides aside to make room: one dragged-tab width, or not at all. */
export function shiftOf(drag: DragState, index: number): number {
  const width = (drag.slots[drag.from]?.width ?? 0) + drag.gap;
  if (index > drag.from && index <= drag.to) return -width;
  if (index < drag.from && index >= drag.to) return width;
  return 0;
}

/** Where the dragged tab will sit once dropped, in the strip's content coordinates. */
export function landingLeft(drag: DragState): number {
  const from = drag.slots[drag.from];
  const to = drag.slots[drag.to];
  if (from === undefined || to === undefined) return 0;
  return drag.to > drag.from ? to.left + to.width - from.width : to.left;
}

/** The insertion point between tabs as they stand, for the caret shown when neighbours do not slide. */
export function caretLeft(drag: DragState): number {
  const to = drag.slots[drag.to];
  if (to === undefined) return 0;
  return drag.to > drag.from ? to.left + to.width + drag.gap / 2 : to.left - drag.gap / 2;
}

function measure(list: HTMLElement): { readonly slots: readonly Slot[]; readonly gap: number } {
  const slots = [...list.querySelectorAll<HTMLElement>("[data-tab-id]")].map((el) => ({
    left: el.offsetLeft,
    width: el.offsetWidth,
  }));
  const [first, second] = slots;
  const gap = first !== undefined && second !== undefined ? second.left - first.left - first.width : 0;
  return { slots, gap };
}

export interface TabDrag {
  readonly drag: DragState | null;
  readonly settle: Settle | null;
  /** The tab a held touch has lifted, before it moves. */
  readonly lifted: string | null;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>, id: string, index: number) => void;
  /** Swallows the click that ends a drag, so dropping a tab never selects it. */
  readonly onClickCapture: (event: { stopPropagation(): void; preventDefault(): void }) => void;
  readonly cancel: () => void;
}

/** Pointer drag for a horizontal strip whose items carry `data-tab-id`; `onMove` gets the item and its new index. */
export function useTabDrag(
  list: RefObject<HTMLElement | null>,
  ids: readonly string[],
  onMove: ((id: string, to: number) => void) | undefined,
): TabDrag {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [settle, setSettle] = useState<Settle | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const press = useRef<Press | null>(null);
  const swallowClick = useRef(false);
  const stop = useRef<() => void>(() => undefined);
  const latestMove = useRef(onMove);
  latestMove.current = onMove;

  const end = useCallback(() => stop.current(), []);

  const update = useCallback(() => {
    const current = press.current;
    const element = list.current;
    if (current === null || current.dragging === null || element === null) return null;
    const { slots, gap, startScroll } = current.dragging;
    const offset = current.clientX - current.startX + element.scrollLeft - startScroll;
    const next: DragState = {
      id: current.id,
      from: current.from,
      to: landingIndex(slots, current.from, offset),
      offset,
      slots,
      gap,
    };
    setDrag(next);
    return next;
  }, [list]);

  const finish = useCallback(
    (commit: boolean) => {
      const current = press.current;
      const last = current === null || current.dragging === null ? null : update();
      end();
      if (last === null) return;
      swallowClick.current = true;
      const to = commit ? last.to : last.from;
      const landed = commit ? landingLeft(last) : (last.slots[last.from]?.left ?? 0);
      const offset = (last.slots[last.from]?.left ?? 0) + last.offset - landed;
      setSettle({ id: last.id, offset, running: false });
      if (to !== last.from) latestMove.current?.(last.id, to);
    },
    [end, update],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string, index: number) => {
      swallowClick.current = false;
      if (event.button !== 0 || press.current !== null || latestMove.current === undefined) return;
      if (event.target instanceof Element && event.target.closest("[data-tab-close]") !== null) return;
      const touch = event.pointerType === "touch";
      const current: Press = {
        id,
        from: index,
        pointerId: event.pointerId,
        touch,
        startX: event.clientX,
        startY: event.clientY,
        armed: !touch,
        clientX: event.clientX,
        dragging: null,
      };
      press.current = current;
      let frame = 0;
      const hold = touch
        ? window.setTimeout(() => {
            current.armed = true;
            setLifted(id);
          }, TOUCH_HOLD_MS)
        : 0;
      const scrollEdges = (): void => {
        const element = list.current;
        if (element !== null && current.dragging !== null) {
          const box = element.getBoundingClientRect();
          const step =
            current.clientX < box.left + EDGE_PX
              ? -EDGE_STEP_PX
              : current.clientX > box.right - EDGE_PX
                ? EDGE_STEP_PX
                : 0;
          if (step !== 0) {
            element.scrollLeft += step;
            update();
          }
        }
        frame = window.requestAnimationFrame(scrollEdges);
      };
      const onMoveEvent = (move: PointerEvent): void => {
        if (move.pointerId !== current.pointerId) return;
        current.clientX = move.clientX;
        const dx = move.clientX - current.startX;
        const dy = move.clientY - current.startY;
        if (!current.armed) {
          if (Math.hypot(dx, dy) > TOUCH_SLOP_PX) end();
          return;
        }
        if (current.dragging === null) {
          const element = list.current;
          if (element === null || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          current.dragging = { ...measure(element), startScroll: element.scrollLeft };
          window.getSelection()?.removeAllRanges();
          frame = window.requestAnimationFrame(scrollEdges);
        }
        update();
      };
      const onUp = (up: PointerEvent): void => {
        if (up.pointerId === current.pointerId) finish(true);
      };
      const onCancel = (cancel: PointerEvent): void => {
        if (cancel.pointerId === current.pointerId) finish(false);
      };
      const onKey = (key: KeyboardEvent): void => {
        if (key.key !== "Escape" || current.dragging === null) return;
        key.preventDefault();
        key.stopPropagation();
        finish(false);
      };
      const onBlur = (): void => finish(false);
      // Once a held touch has lifted the tab, moving the finger drags it instead of scrolling the strip.
      const onTouchMove = (touchMove: TouchEvent): void => {
        if (current.armed && touchMove.cancelable) touchMove.preventDefault();
      };
      window.addEventListener("pointermove", onMoveEvent);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, { capture: true });
      window.addEventListener("blur", onBlur);
      if (touch) window.addEventListener("touchmove", onTouchMove, { passive: false });
      stop.current = () => {
        window.clearTimeout(hold);
        window.cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMoveEvent);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, { capture: true });
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("touchmove", onTouchMove);
        press.current = null;
        stop.current = () => undefined;
        setDrag(null);
        setLifted(null);
      };
    },
    [end, finish, list, update],
  );

  // The settle runs in two frames: first at the drop offset with no transition, then to its slot.
  useEffect(() => {
    if (settle === null) return;
    if (!settle.running) {
      const frame = window.requestAnimationFrame(() => setSettle({ ...settle, running: true }));
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => setSettle(null), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settle]);

  // A tab that opens or closes mid-drag changes every index, so the drag gives up.
  const order = ids.join("\n");
  useEffect(() => end, [order, end]);

  const onClickCapture = useCallback((event: { stopPropagation(): void; preventDefault(): void }) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  return { drag, settle, lifted, onPointerDown, onClickCapture, cancel: end };
}
