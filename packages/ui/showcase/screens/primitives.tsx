import { Copy, Plus, Settings, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AgentRow,
  Badge,
  Button,
  CommandPalette,
  DialogPanel,
  EmptyState,
  ExtraKeysBar,
  Field,
  Fingerprint,
  IconButton,
  Input,
  Kbd,
  Menu,
  MenuItem,
  MenuSeparator,
  Notice,
  NumberStepper,
  Popover,
  QrCode,
  SegmentedControl,
  SettingRow,
  SheetPanel,
  Skeleton,
  SpaceRow,
  StatusChip,
  StatusIndicator,
  Switch,
  Tab,
  TabBar,
  TabList,
  Tabs,
  TerminalPreview,
  Tooltip,
  ToastViewport,
  useToastManager,
  type AgentStatus,
} from "../../src/index.ts";
import {
  AGENTS_DONE,
  AGENTS_IDLE,
  AGENTS_NEEDS_YOU,
  AGENTS_WORKING,
  COMMANDS,
  SPACES,
  TABS,
  sampleQrModules,
} from "../data.ts";
import { Cell, FORCED, Row, Section } from "./specimen.tsx";

const STATUSES: readonly AgentStatus[] = ["working", "blocked", "done", "idle", "unknown"];
const VARIANTS = ["primary", "secondary", "ghost", "destructive"] as const;
const ANSI_LINE = Array.from({ length: 16 }, (_, color) => ({ text: ` ${color.toString().padStart(2, "0")} `, color }));

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

export function PrimitivesScreen() {
  const [toastHost, setToastHost] = useState<HTMLDivElement | null>(null);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 pb-40 md:px-8">
      <ToastOnMount />
      <header>
        <h1 className="text-2xl font-semibold text-foreground">doriface primitives</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Every component in packages/ui, in each state it ships with.
        </p>
      </header>

      <Section title="Button">
        {VARIANTS.map((variant) => (
          <Row key={variant}>
            {FORCED.map((state) => (
              <Cell key={state.label} label={`${variant} · ${state.label}`}>
                <Button variant={variant} data-force={state.force}>
                  Pair host
                </Button>
              </Cell>
            ))}
            <Cell label={`${variant} · disabled`}>
              <Button variant={variant} disabled>
                Pair host
              </Button>
            </Cell>
            <Cell label={`${variant} · loading`}>
              <Button variant={variant} loading>
                Pair host
              </Button>
            </Cell>
          </Row>
        ))}
        <Row>
          <Cell label="sm">
            <Button size="sm">Small</Button>
          </Cell>
          <Cell label="md">
            <Button>Medium</Button>
          </Cell>
          <Cell label="lg">
            <Button size="lg">Large</Button>
          </Cell>
        </Row>
      </Section>

      <Section title="IconButton and Tooltip">
        <Row>
          {FORCED.map((state) => (
            <Cell key={state.label} label={state.label}>
              <IconButton label="New tab" icon={<Plus />} data-force={state.force} />
            </Cell>
          ))}
          <Cell label="pressed toggle">
            <IconButton label="Settings" icon={<Settings />} pressed />
          </Cell>
          <Cell label="disabled">
            <IconButton label="Copy" icon={<Copy />} disabled />
          </Cell>
          <Cell label="tooltip open" className="pb-8">
            <Tooltip label="Close pane" keys={["⌘", "⇧", "W"]} defaultOpen>
              <Button size="sm">Hover target</Button>
            </Tooltip>
          </Cell>
        </Row>
      </Section>

      <Section title="Input and Field">
        <Row className="[&>*]:w-60">
          {FORCED.map((state) => (
            <Cell key={state.label} label={state.label}>
              <Input aria-label={`Host, ${state.label}`} placeholder="host.local:7501" data-force={state.force} />
            </Cell>
          ))}
          <Cell label="invalid">
            <Input aria-label="Host, invalid" defaultValue="host:99999" invalid />
          </Cell>
          <Cell label="disabled">
            <Input aria-label="Host, disabled" defaultValue="relay-doriface.omo.dev" disabled />
          </Cell>
          <Field label="Pairing code" htmlFor="code-demo" hint="8 characters">
            <Input id="code-demo" mono defaultValue="F7K3 9D2M" />
          </Field>
          <Field label="Host address" htmlFor="host-demo" error="Port must be 1-65535.">
            <Input id="host-demo" defaultValue="studio.local:99999" invalid />
          </Field>
        </Row>
      </Section>

      <Section title="Switch, SegmentedControl, NumberStepper, Tabs">
        <Row>
          <Cell label="off">
            <Switch aria-label="Sounds off" />
          </Cell>
          <Cell label="on">
            <Switch aria-label="Sounds on" defaultChecked />
          </Cell>
          <Cell label="focus-visible">
            <Switch aria-label="Sounds focus" data-force="focus" />
          </Cell>
          <Cell label="disabled">
            <Switch aria-label="Sounds disabled" disabled defaultChecked />
          </Cell>
          <Cell label="segmented">
            <SegmentedControl
              label="Route"
              value="relay"
              options={[
                { value: "relay", label: "Relay" },
                { value: "direct", label: "Direct" },
              ]}
            />
          </Cell>
          <Cell label="stepper">
            <NumberStepper label="Font size" defaultValue={14} min={9} max={28} />
          </Cell>
          <Cell label="tabs" className="w-80">
            <Tabs defaultValue="connections" className="w-full">
              <TabList>
                <Tab value="connections">Connections</Tab>
                <Tab value="appearance">Appearance</Tab>
                <Tab value="keyboard">Keyboard</Tab>
              </TabList>
            </Tabs>
          </Cell>
        </Row>
      </Section>

      <Section title="Status">
        <Row>
          {STATUSES.map((status) => (
            <Cell key={status} label={status}>
              <span className="flex items-center gap-3">
                <StatusIndicator status={status} />
                <StatusChip status={status} />
              </span>
            </Cell>
          ))}
          <Cell label="badges">
            <span className="flex gap-2">
              <Badge>3</Badge>
              <Badge tone="blocked">1 needs you</Badge>
              <Badge tone="done">27 passed</Badge>
              <Badge tone="working">running</Badge>
            </span>
          </Cell>
          <Cell label="kbd">
            <Kbd keys={["⌘", "⇧", "P"]} />
          </Cell>
        </Row>
      </Section>

      <Section title="AgentRow, SpaceRow, TabBar">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-px rounded-lg bg-sidebar p-2">
            {[...AGENTS_NEEDS_YOU, ...AGENTS_DONE, ...AGENTS_WORKING, ...AGENTS_IDLE].map((agent) => (
              <AgentRow key={agent.id} agent={agent} selected={agent.id === "a2"} />
            ))}
            <AgentRow agent={{ id: "h", name: "Claude Code", detail: "hover", status: "working" }} data-force="hover" />
            <AgentRow agent={{ id: "f", name: "Codex", detail: "focus-visible", status: "idle" }} data-force="focus" />
            <AgentRow
              agent={{ id: "c", name: "Claude Code", detail: "compact blocked", status: "blocked" }}
              compactBlocked
            />
            <AgentRow
              agent={{
                id: "l",
                name: "Claude Code",
                detail: "a very long tab title that has to truncate without clipping",
                status: "done",
                machine: "build-box",
                age: "3d",
                pinned: true,
              }}
            />
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-px rounded-lg bg-sidebar p-2">
              {SPACES.map((space) => (
                <SpaceRow key={space.id} space={space} selected={space.id === "api"} />
              ))}
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <TabBar tabs={TABS} activeId="t1" />
            </div>
          </div>
        </div>
      </Section>

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

      <Section title="Pairing and settings parts">
        <div className="grid items-start gap-6 md:grid-cols-3">
          <QrCode modules={sampleQrModules()} label="Sample QR code" className="w-40 border border-border p-1" />
          <Fingerprint label="Received" value="3fa94c0e91c4d8559e04b0f27f3bd2a08c4e6f19" mismatched={[2, 5]} />
          <div>
            <SettingRow
              title="Sounds"
              description="Play a sound when an agent needs you."
              control={<Switch aria-label="Sounds" defaultChecked />}
            />
          </div>
        </div>
      </Section>

      <Section title="Terminal">
        <div className="overflow-hidden rounded-lg border border-border">
          <TerminalPreview
            label="ANSI colours 0 to 15"
            lines={[ANSI_LINE.slice(0, 8), ANSI_LINE.slice(8), [{ text: "default foreground" }]]}
            cursor
          />
          <ExtraKeysBar latched={["ctrl"]} />
        </div>
      </Section>
    </main>
  );
}
