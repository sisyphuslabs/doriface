import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { rememberStop, rovingTarget, syncStops } from "./roving.ts";

const MODIFIED = (event: KeyboardEvent): boolean => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

/** Wraps the sidebar lists so each is one Tab stop with arrow-key movement inside, as rows come and go. */
export function RovingLists({ children }: { readonly children: ReactNode }) {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    syncStops(element);
    const observer = new MutationObserver(() => syncStops(element));
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current", "disabled"],
    });
    return () => observer.disconnect();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (MODIFIED(event) || root.current === null) return;
    const next = rovingTarget(root.current, event.target, event.key);
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <div ref={root} data-roving-lists onKeyDown={onKeyDown} onFocus={(event) => rememberStop(event.target)}>
      {children}
    </div>
  );
}
