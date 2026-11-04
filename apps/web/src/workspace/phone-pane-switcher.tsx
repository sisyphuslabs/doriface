import { IconButton } from "@doriface/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A phone shows one pane of a split tab at a time; this steps through the tab's panes in order, as a swipe would
 * between full-screen pages, with 44 pt targets.
 */
export function PaneSwitcher(props: {
  readonly panes: readonly string[];
  readonly open: string;
  readonly onOpen: (address: string) => void;
}) {
  const { panes, open, onOpen } = props;
  const at = panes.indexOf(open);
  if (panes.length < 2 || at === -1) return null;
  const step = (by: 1 | -1): void => {
    const next = panes[(at + by + panes.length) % panes.length];
    if (next !== undefined) onOpen(next);
  };
  return (
    <nav
      aria-label="Panes in this tab"
      className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-chrome px-1.5"
    >
      <IconButton label="Previous pane" icon={<ChevronLeft />} size="md" onClick={() => step(-1)} />
      <span aria-live="polite" className="text-xs text-muted-foreground">
        Pane {at + 1} of {panes.length}
      </span>
      <IconButton label="Next pane" icon={<ChevronRight />} size="md" onClick={() => step(1)} />
    </nav>
  );
}
