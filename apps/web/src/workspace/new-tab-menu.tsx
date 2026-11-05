import type { HcConnection } from "@doriface/client";
import type { TemplateInfo } from "@doriface/protocol";
import { MenuCaption, MenuItem, MenuSeparator } from "@doriface/ui";
import { Bot, Plus, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";

// After the menu's own click handling, which focuses the item it closes on: what the choice starts (type-ahead's
// input for a new terminal) then keeps the keyboard from the first key typed. Still before the next key event.
const after = (action: () => void) => () => queueMicrotask(action);

/**
 * herdr-app's new menu behind the tab strip's + (#466 item 7): a terminal, the agents hc can start (its templates, read
 * each time the menu opens), and a new space. Ctrl+Shift+T stays a direct new tab.
 */
export function NewTabMenu(props: {
  readonly connection: HcConnection;
  readonly newTabKeys: readonly string[] | undefined;
  readonly onNew: () => void;
  readonly onAgent: (template: string) => void;
  readonly onSpace: () => void;
}) {
  const { connection, newTabKeys, onNew, onAgent, onSpace } = props;
  const [agents, setAgents] = useState<readonly TemplateInfo[] | "failed" | null>(null);
  useEffect(() => {
    let live = true;
    connection.call("templates.list").then(
      (result) => live && setAgents(result.templates),
      () => live && setAgents("failed"),
    );
    return () => {
      live = false;
    };
  }, [connection]);
  return (
    <>
      <MenuItem
        icon={<SquareTerminal />}
        {...(newTabKeys === undefined ? {} : { keys: newTabKeys })}
        onClick={after(onNew)}
      >
        Terminal
      </MenuItem>
      <MenuCaption>Start an agent</MenuCaption>
      {agents === null || agents === "failed" || agents.length === 0 ? (
        <MenuItem disabled>
          {agents === null ? "Checking installed agents…" : agents === "failed" ? "Could not load agents" : "No agents"}
        </MenuItem>
      ) : (
        agents.map((agent) => (
          <MenuItem key={agent.name} icon={<Bot />} onClick={after(() => onAgent(agent.name))}>
            {agent.name}
          </MenuItem>
        ))
      )}
      <MenuSeparator />
      <MenuItem icon={<Plus />} onClick={after(onSpace)}>
        New space
      </MenuItem>
    </>
  );
}
