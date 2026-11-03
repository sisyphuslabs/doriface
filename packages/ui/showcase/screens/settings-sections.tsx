import { Laptop, Smartphone, Tablet } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  BUILTIN_PALETTES,
  Button,
  Input,
  NumberStepper,
  SegmentedControl,
  SettingRow,
  ThemePicker,
  resolveTheme,
  type ThemeOption,
} from "../../src/index.ts";

const THEMES: readonly ThemeOption[] = [
  {
    id: "system",
    name: "System",
    source: "Day or Night, as the device",
    theme: resolveTheme(BUILTIN_PALETTES.day),
    dark: resolveTheme(BUILTIN_PALETTES.night),
  },
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

export function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h2 className="pb-1 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function ConnectionSection() {
  const [route, setRoute] = useState<"relay" | "direct">("relay");
  return (
    <>
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
                { value: "direct", label: "Direct on LAN" },
              ]}
            />
          }
        />
        <SettingRow
          title="Relay address"
          description="Change it only for a relay you run yourself."
          control={
            <Input aria-label="Relay address" mono defaultValue="relay-doriface.omo.dev" className="w-full sm:w-64" />
          }
        />
      </Group>
      <Group title="Paired devices">
        {DEVICES.map((device) => (
          <SettingRow
            key={device.id}
            inline
            title={
              <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
                {device.kind}
                {device.name}
              </span>
            }
            description={device.seen}
            control={
              device.seen === "This device" ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Revoke ${device.name}`}
                  className="text-destructive hover:text-destructive"
                >
                  Revoke
                </Button>
              )
            }
          />
        ))}
      </Group>
    </>
  );
}

export function AppearanceSection() {
  return (
    <Group title="Appearance">
      <div className="py-3">
        <ThemePicker options={THEMES} value="system" />
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
  );
}
