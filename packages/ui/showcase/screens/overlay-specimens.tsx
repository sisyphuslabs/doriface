import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  CommandPalette,
  DialogPanel,
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  Notice,
  Popover,
  SheetPanel,
  Skeleton,
  ToastViewport,
  useToastManager,
} from "../../src/index.ts";
import { COMMANDS } from "../data.ts";
import { Cell, Section } from "./specimen.tsx";

function ToastOnMount() {
  const toasts = useToastManager();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toasts.add({ title: "Codex finished", description: "file sync tests · 27 passed", type: "success", timeout: 0 });
  }, [toasts]);
  return null;
}

/** Menus, popovers, dialogs, sheets and the palette, then notices, skeletons, a toast and an empty state. */
export function OverlaySpecimens() {
  const [toastHost, setToastHost] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <ToastOnMount />
      <Section title="Overlays">
        <div className="grid items-start gap-6 md:grid-cols-3">
          <Cell label="menu (open)" className="h-56">
            <Menu defaultOpen fixedSide trigger={<Button size="sm">Pane</Button>}>
              <MenuItem keys={["⌘", "D"]}>Split right</MenuItem>
              <MenuItem keys={["⌘", "⇧", "D"]}>Split down</MenuItem>
              <MenuSeparator />
              <MenuItem destructive icon={<Trash2 />}>
                Close pane
              </MenuItem>
            </Menu>
          </Cell>
          <Cell label="popover (open)" className="h-56">
            <Popover defaultOpen fixedSide title="Route" trigger={<Button size="sm">Relay</Button>}>
              <p className="text-sm text-muted-foreground">
                Connected through relay-doriface.omo.dev. Traffic is end-to-end encrypted.
              </p>
            </Popover>
          </Cell>
          <Cell label="dialog panel">
            <DialogPanel
              title="Close this pane?"
              description="Claude Code is still working. Closing the pane stops it."
              actions={
                <>
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="destructive">Close pane</Button>
                </>
              }
            />
          </Cell>
          <Cell label="sheet panel" className="w-full">
            <div className="w-full max-w-sm">
              <SheetPanel title="Agent actions">
                <div className="flex flex-col gap-2">
                  <Button variant="secondary">Open terminal</Button>
                  <Button variant="ghost">Pin to top</Button>
                </div>
              </SheetPanel>
            </div>
          </Cell>
          <Cell label="command palette" className="md:col-span-2">
            <CommandPalette commands={COMMANDS.slice(0, 5)} />
          </Cell>
        </div>
      </Section>

      <Section title="Feedback">
        <div className="grid gap-4 md:grid-cols-2">
          <Notice title="Paired with studio">Agents on studio show up in the sidebar.</Notice>
          <Notice tone="warning" title="Can't reach the relay" actions={<Button size="sm">Retry</Button>}>
            Trying again in 10 s.
          </Notice>
          <Notice tone="error" title="Pairing code expired">
            Ask the host for a new code.
          </Notice>
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3" aria-label="Loading agents">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
          <div ref={setToastHost} aria-label="Toast" className="md:col-span-2">
            {toastHost === null ? null : <ToastViewport container={toastHost} className="w-full max-w-sm" />}
          </div>
          <div className="rounded-lg border border-border md:col-span-2">
            <EmptyState
              title="No agents yet"
              description="Agents appear here when they report their status."
              actions={<Button variant="primary">Open a terminal</Button>}
            />
          </div>
        </div>
      </Section>
    </>
  );
}
