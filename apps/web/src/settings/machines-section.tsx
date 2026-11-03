import type { HcConnection } from "@doriface/client";
import type { MachineView, Terminal } from "@doriface/protocol";
import { Notice, SettingRow, cn } from "@doriface/ui";
import { Monitor, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useConnection } from "../connection/store.ts";
import { machineCause } from "../workspace/machine-cause.ts";
import { RetryButton } from "../workspace/retry-button.tsx";
import { formatAge } from "../workspace/model.ts";
import { useMachines } from "../workspace/use-machines.ts";
import { useNow } from "../workspace/use-now.ts";

const NO_TERMINALS: readonly Terminal[] = [];

const STATE_WORDS: Readonly<Record<string, string>> = {
  connected: "Connected",
  connecting: "Connecting",
  needs_login: "Needs a login",
  unreachable: "Offline",
};

function title(icon: ReactNode, name: string) {
  return (
    <span className="flex min-w-0 items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
      {icon}
      <span title={name} className="truncate">
        {name}
      </span>
    </span>
  );
}

function lastSeen(view: MachineView, now: number): string | undefined {
  if (view.state === "connected" || view.since_ms === undefined || view.since_ms === null) return undefined;
  const age = formatAge(view.since_ms, now);
  return age === "<1m" ? "Last seen just now" : `Last seen ${age} ago`;
}

/** States that need the person: they get the attention hue and Try again; connecting is a routine redial. */
const PROBLEMS = new Set(["unreachable", "needs_login"]);

function AddedMachine(props: { view: MachineView; now: number; onRetry: () => Promise<void> }) {
  const { view, now, onRetry } = props;
  const cause = machineCause(view);
  const seen = lastSeen(view, now);
  const word = STATE_WORDS[view.state] ?? "Not connected";
  const problem = PROBLEMS.has(view.state);
  return (
    <li>
      <SettingRow
        className="border-b-0"
        inline
        title={title(<Server aria-hidden />, view.name)}
        description={
          <>
            <span className={cn(problem && "text-status-blocked-text")}>{word}</span>
            {seen === undefined ? null : ` · ${seen}`}
            {cause === undefined ? null : <span className="block">{cause.detail}</span>}
          </>
        }
        control={problem ? <RetryButton size="sm" onRetry={onRetry} /> : null}
      />
    </li>
  );
}

function MachineRows({ connection }: { readonly connection: HcConnection }) {
  const { views, retry, listError } = useMachines(connection, NO_TERMINALS);
  const now = useNow();
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Machines" className="flex flex-col divide-y divide-border">
        <li>
          <SettingRow
            className="border-b-0"
            title={title(<Monitor aria-hidden />, connection.hello.core.name)}
            description="This machine"
            control={null}
          />
        </li>
        {views.map((view) => (
          <AddedMachine key={view.id} view={view} now={now} onRetry={() => retry(view.name)} />
        ))}
      </ul>
      {listError === undefined ? null : (
        <Notice tone="error" title="Could not list the machines">
          {listError}
        </Notice>
      )}
      <p className="text-sm text-pretty text-muted-foreground">
        To add one, run <code className="font-mono text-xs text-foreground">hc machine add</code> on this machine with
        an ssh target, or with <code className="font-mono text-xs text-foreground">--via</code> and a doriface-host
        connect command for a machine behind the relay.
      </p>
    </div>
  );
}

/** Every machine this host reaches, this one first: its state, and when it was last seen and why when it is offline. */
export function MachinesSection() {
  const state = useConnection();
  if (state.phase !== "open") {
    return (
      <Notice tone="info" title="Not connected">
        Connect to your host to see its machines.
      </Notice>
    );
  }
  return <MachineRows connection={state.connection} />;
}
