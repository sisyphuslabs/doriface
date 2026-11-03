import { ChevronLeft, Link2, Palette, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, IconButton, ScrollArea, Tab, TabList, Tabs, cn } from "../../src/index.ts";
import { AppearanceSection, ConnectionSection } from "./settings-sections.tsx";

export type SettingsSection = "connection" | "appearance";

const SECTIONS = [
  { id: "connection", label: "Connection", icon: <Link2 /> },
  { id: "appearance", label: "Appearance", icon: <Palette /> },
] as const;

const BODY: Readonly<Record<SettingsSection, () => ReactNode>> = {
  connection: () => <ConnectionSection />,
  appearance: () => <AppearanceSection />,
};

/** List-detail settings: section navigation beside one section's form, which scrolls on its own. */
export function SettingsScreen({ section = "connection" }: { readonly section?: SettingsSection }) {
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background md:flex-row">
      <Tabs value={section} className="md:hidden">
        <header className="box-content flex h-12 items-center gap-1 px-1.5 pt-(--safe-top)">
          <IconButton label="Back to agents" icon={<ChevronLeft />} size="md" />
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        </header>
        <TabList className="overflow-x-auto px-2">
          {SECTIONS.map((entry) => (
            <Tab key={entry.id} value={entry.id}>
              {entry.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      <nav
        aria-label="Settings"
        className="hidden w-56 shrink-0 flex-col gap-px border-r border-sidebar-border bg-sidebar p-2 md:flex"
      >
        <div className="flex items-center gap-1 pt-1 pb-2 pl-2">
          <h1 className="flex-1 text-lg font-semibold text-foreground">Settings</h1>
          <IconButton label="Close settings" keys={["esc"]} icon={<X />} />
        </div>
        {SECTIONS.map((entry) => (
          <Button
            key={entry.id}
            variant="ghost"
            aria-current={entry.id === section ? "page" : undefined}
            className={cn(
              "justify-start gap-2.5 px-2 text-sm [&_svg]:size-3.5",
              entry.id === section && "bg-selected text-foreground",
            )}
          >
            {entry.icon}
            {entry.label}
          </Button>
        ))}
      </nav>
      <ScrollArea slot="settings-body" className="flex-1">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 pt-6 pb-[max(1.5rem,var(--safe-bottom))] md:px-8">
          {BODY[section]()}
        </div>
      </ScrollArea>
    </div>
  );
}

export function SettingsAppearanceScreen() {
  return <SettingsScreen section="appearance" />;
}
