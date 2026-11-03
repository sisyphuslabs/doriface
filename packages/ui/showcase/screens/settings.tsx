import { Keyboard, Laptop, Link2, Palette, Smartphone, Tablet } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  BUILTIN_PALETTES,
  Button,
  Input,
  NumberStepper,
  ScrollArea,
  SegmentedControl,
  SettingRow,
  Tab,
  TabList,
  Tabs,
  ThemePicker,
  cn,
  resolveTheme,
  type ThemeOption,
} from "../../src/index.ts";

const SECTIONS = [
  { id: "connections", label: "Connections", icon: <Link2 /> },
  { id: "appearance", label: "Appearance", icon: <Palette /> },
  { id: "keyboard", label: "Keyboard", icon: <Keyboard /> },
] as const;

const THEMES: readonly ThemeOption[] = [
  { id: "night", name: "Night", source: "doriface", theme: resolveTheme(BUILTIN_PALETTES.night) },
  { id: "day", name: "Day", source: "doriface", theme: resolveTheme(BUILTIN_PALETTES.day) },
  { id: "graphite", name: "Graphite", source: "herdr-app", theme: resolveTheme(BUILTIN_PALETTES.graphite) },
  { id: "paper", name: "Paper", source: "herdr-app", theme: resolveTheme(BUILTIN_PALETTES.paper) },
];

const DEVICES = [
  { id: "d1", name: "MacBook Pro", kind: <Laptop />, seen: "This device" },
  { id: "d2", name: "iPhone", kind: <Smartphone />, seen: "Active 5 min ago" },
  { id: "d3", name: "iPad", kind: <Tablet />, seen: "Active 3 days ago" },
] as const;

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="pb-1 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsScreen() {
  const [route, setRoute] = useState<"relay" | "direct">("relay");
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background md:flex-row">
      <Tabs defaultValue="connections" className="md:hidden">
        <h1 className="px-4 pt-3 pb-1 text-xl font-semibold text-foreground">Settings</h1>
        <TabList className="px-2">
          {SECTIONS.map((section) => (
            <Tab key={section.id} value={section.id}>
              {section.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      <nav
        aria-label="Settings"
        className="hidden w-56 shrink-0 flex-col gap-px border-r border-sidebar-border bg-sidebar p-2 md:flex"
      >
        <h1 className="px-2 pt-2 pb-3 text-lg font-semibold text-foreground">Settings</h1>
        {SECTIONS.map((section) => (
          <Button
            key={section.id}
            variant="ghost"
            aria-current={section.id === "connections" ? "page" : undefined}
            className={cn(
              "justify-start gap-2.5 px-2 text-sm [&_svg]:size-3.5",
              section.id === "connections" && "bg-selected text-foreground",
            )}
          >
            {section.icon}
            {section.label}
          </Button>
        ))}
      </nav>
      <ScrollArea slot="settings-body" className="flex-1">
        <div className="flex max-w-2xl flex-col gap-8 px-4 py-6 md:px-8">
          <Group title="Connection">
            <SettingRow
              title="Connect through"
              description="The relay works from anywhere and only forwards encrypted traffic."
              control={
                <SegmentedControl
                  label="Connect through"
                  value={route}
                  onValueChange={setRoute}
                  options={[
                    { value: "relay", label: "Relay" },
                    { value: "direct", label: "Direct" },
                  ]}
                />
              }
            />
            <SettingRow
              title="Relay address"
              description="Change it only for a relay you run yourself."
              control={
                <Input
                  aria-label="Relay address"
                  mono
                  defaultValue="relay-doriface.omo.dev"
                  className="w-full sm:w-64"
                />
              }
            />
          </Group>
          <Group title="Paired devices">
            {DEVICES.map((device) => (
              <SettingRow
                key={device.id}
                title={
                  <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
                    {device.kind}
                    {device.name}
                  </span>
                }
                description={device.seen}
                control={
                  device.seen === "This device" ? null : (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                      Revoke
                    </Button>
                  )
                }
              />
            ))}
          </Group>
          <Group title="Appearance">
            <div className="py-3">
              <ThemePicker options={THEMES} value="night" />
            </div>
            <SettingRow
              title="Import a herdr-app theme"
              description="Any themes/<name>.json from herdr-app works unchanged."
              control={<Button size="sm">Choose file…</Button>}
            />
            <SettingRow
              title="Terminal font size"
              control={<NumberStepper label="Terminal font size" defaultValue={14} min={9} max={28} />}
            />
          </Group>
        </div>
      </ScrollArea>
    </div>
  );
}
