import { FileUp, Search } from "lucide-react";
import { Badge, Button, Input, SettingRow, ShortcutField, type ShortcutFieldProps } from "../../src/index.ts";
import { Group } from "./settings-sections.tsx";

type Binding = { readonly title: string; readonly action: string; readonly scope: string } & Pick<
  ShortcutFieldProps,
  "keys" | "state" | "pending" | "conflictWith" | "modified"
>;

const GROUPS: readonly { readonly title: string; readonly bindings: readonly Binding[] }[] = [
  {
    title: "Tabs",
    bindings: [
      { title: "New tab", action: "new_tab", scope: "Workspace", keys: ["⌘", "T"] },
      { title: "Close tab", action: "close_tab", scope: "Workspace", keys: ["⌘", "W"] },
      { title: "Next tab", action: "next_tab", scope: "Workspace", keys: ["⌃", "⇥"], modified: true },
    ],
  },
  {
    title: "Panes",
    bindings: [
      { title: "Split right", action: "new_split:right", scope: "Terminal", keys: ["⌘", "D"] },
      {
        title: "Split down",
        action: "new_split:down",
        scope: "Terminal",
        keys: ["⌘", "⇧", "D"],
        state: "recording",
        pending: ["⌘", "⌥"],
      },
    ],
  },
  {
    title: "Agents",
    bindings: [
      { title: "Next agent that needs you", action: "doriface:agent_next", scope: "Global", keys: ["⌘", "]"] },
      {
        title: "Previous agent",
        action: "doriface:agent_prev",
        scope: "Global",
        keys: ["⌘", "["],
        state: "conflict",
        pending: ["⌘", "B"],
        conflictWith: "Toggle sidebar",
      },
    ],
  },
  {
    title: "App",
    bindings: [
      { title: "Commands", action: "toggle_command_palette", scope: "Global", keys: ["⌘", "⇧", "P"] },
      { title: "Settings", action: "open_config", scope: "Global", keys: ["⌘", ","] },
    ],
  },
];

/** Key bindings by group: the action, its Ghostty action name and scope, and a re-recordable shortcut. */
export function KeyboardSection() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-lg font-semibold text-foreground md:text-xl">Keyboard</h2>
          <Button size="sm">
            <FileUp />
            Import Ghostty keybinds…
          </Button>
        </div>
        <p className="text-sm text-pretty text-muted-foreground">
          Click a shortcut to record a new one. Bindings use Ghostty's keybind actions.
        </p>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input aria-label="Search shortcuts" placeholder="Search actions or keys" className="pl-8" />
        </div>
      </div>
      {GROUPS.map((group) => (
        <Group key={group.title} title={group.title}>
          {group.bindings.map(({ title, action, scope, ...field }) => (
            <SettingRow
              key={action}
              inline={field.state !== "conflict"}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {title}
                  <Badge>{scope}</Badge>
                </span>
              }
              configKey={action}
              control={<ShortcutField action={title} {...field} />}
            />
          ))}
        </Group>
      ))}
    </>
  );
}
