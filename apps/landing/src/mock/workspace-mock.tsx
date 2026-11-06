import {
  AgentRow,
  IconButton,
  SidebarSection,
  SpaceRow,
  StatusBar,
  StatusBarItem,
  TabBar,
  type Agent,
  type Space,
  type WorkspaceTab,
} from "@doriface/ui";
import { Bot, Folder, Monitor, Search, Settings, SquareTerminal, Terminal } from "lucide-react";
import type { ReactNode } from "react";

const SPACES: readonly Space[] = [
  { id: "website", name: "website", tabs: 2, attention: "blocked", color: "orange" },
  { id: "doriterm", name: "doriterm", tabs: 2, color: "blue" },
  { id: "infra", name: "infra", machine: "build-box", tabs: 3, attention: "working", color: "green" },
];

const NEEDS_YOU: readonly Agent[] = [
  { id: "deploy", name: "deploy", status: "blocked", detail: "Approve the deploy", age: "<1m" },
];

const WORKING: readonly Agent[] = [
  { id: "review", name: "review", status: "working", detail: "Reviewing the relay", machine: "build-box", age: "<1m" },
  { id: "plan", name: "plan", status: "working", detail: "terraform", machine: "build-box", age: "2m" },
];

const IDLE: readonly Agent[] = [
  { id: "shell", name: "shell", status: "idle", detail: "doriterm", age: "6m" },
  { id: "logs", name: "logs", status: "idle", detail: "infra", machine: "build-box", age: "12m" },
];

const TABS: readonly WorkspaceTab[] = [
  { id: "t1", title: "1", icon: <Terminal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> },
  {
    id: "t2",
    title: "deploy",
    icon: <Bot aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
    status: "blocked",
  },
  {
    id: "t3",
    title: "2",
    icon: <SquareTerminal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />,
  },
];

interface PaneProps {
  readonly title: string;
  readonly focused: boolean;
  readonly lines: readonly ReactNode[];
}

function Pane({ title, focused, lines }: PaneProps): ReactNode {
  return (
    <div
      data-focused={focused || undefined}
      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span className="truncate">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 py-2 text-[13px] leading-6 [color:var(--term-fg)] [font-family:var(--font-term)]">
        {lines.map((line, index) => (
          <div key={index} className="whitespace-pre-wrap break-words">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The desktop workspace, composed from the app's own components with fixture data: no host, no network. */
export function WorkspaceMock({ mark }: { readonly mark: string }): ReactNode {
  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <aside className="flex w-(--sidebar-width) shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <img src={mark} alt="" width={20} height={20} className="size-5" />
          <span className="text-sm font-semibold">Doriterm</span>
          <IconButton label="Search" icon={<Search />} className="ml-auto size-6" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-2 pb-3">
          <div data-detect-ignore="low-contrast">
            <SidebarSection title="Spaces" count={SPACES.length}>
              {SPACES.map((space) => (
                <SpaceRow key={space.id} space={space} selected={space.id === "doriterm"} />
              ))}
            </SidebarSection>
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <SidebarSection title="Needs you" count={NEEDS_YOU.length} tone="text-status-blocked-text">
              {NEEDS_YOU.map((agent) => (
                <AgentRow key={agent.id} agent={agent} compactBlocked />
              ))}
            </SidebarSection>
            <SidebarSection title="Working" count={WORKING.length} tone="text-status-working-text">
              {WORKING.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </SidebarSection>
            <SidebarSection title="Idle" count={IDLE.length}>
              {IDLE.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </SidebarSection>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-2 text-xs text-muted-foreground">
          <Settings aria-hidden className="size-3.5" />
          Settings
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar tabs={TABS} activeId="t2" className="border-b border-border" />
        <div className="flex min-h-0 flex-1 gap-2 p-2">
          <Pane
            title="deploy"
            focused={false}
            lines={[<span key="a">Build passed</span>, <span key="b">Waiting for approval</span>]}
          />
          <Pane
            title="sh"
            focused
            lines={[
              <span key="c">
                <span className="text-muted-foreground">$ </span>
                hc machine add --via &apos;doriface-host connect b&apos; --name b
              </span>,
              <span key="d" className="text-muted-foreground">
                b/t1 b/t2 added
              </span>,
              <span key="e">
                <span className="text-muted-foreground">$ </span>
              </span>,
            ]}
          />
        </div>
        <StatusBar
          start={
            <>
              <StatusBarItem icon={<Monitor />}>studio</StatusBarItem>
              <StatusBarItem icon={<Folder />}>website</StatusBarItem>
              <StatusBarItem>7 terminals · 1 needs you</StatusBarItem>
            </>
          }
          end={<StatusBarItem>⌘⇧P Commands</StatusBarItem>}
        />
      </div>
    </div>
  );
}
