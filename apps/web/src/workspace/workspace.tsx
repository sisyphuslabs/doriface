import type { HcConnection } from "@doriface/client";
import { useToastManager } from "@doriface/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectionStore } from "../connection/store.ts";
import { useActionHandler } from "../keys/dispatcher.ts";
import { type Axis, LAYOUT_DOC, ORDER_DOC } from "@doriface/protocol/layout";
import { closesTab, type TerminalEnd } from "../terminal/terminal-end.ts";
import { CloseTabDialog } from "./close-tab-dialog.tsx";
import { AddMachineDialog } from "./add-machine-dialog.tsx";
import { DesktopShell } from "./desktop-shell.tsx";
import { Palette } from "./palette.tsx";
import { SessionContext, type SessionAsk } from "./session-context.ts";
import { SessionDialogs } from "./session-dialogs.tsx";
import { availableActions } from "./shell-actions.ts";
import { PhoneShell } from "./phone-shell.tsx";
import type { SessionVerb } from "./use-app-actions.ts";
import { useMachineRuns } from "./use-machine-runs.ts";
import { PIN_LABEL } from "./sidebar-model.ts";
import { PinContext, type PinTerminal } from "./use-pin.ts";
import { MachinesContext, useMachines } from "./use-machines.ts";
import { runParamsFor } from "./new-terminal.ts";
import { useNarrow } from "./use-narrow.ts";
import { machineIds, tabAddress, tabKey } from "./tab-keys.ts";
import { findTerminal } from "./layout-model.ts";
import { useLayout, type PaneTarget } from "./use-layout.ts";
import { chainedSplit, SplitChain } from "./split-chain.ts";
import { afterEnd } from "./session-actions.ts";
import { useDeadPanes } from "./use-dead-panes.ts";
import { useLayoutDocs } from "./use-layout-docs.ts";
import { GitFactsContext, useGitFacts } from "./git-facts.ts";
import { orderNotSaved } from "./machine-order.ts";
import { useMachineOrder } from "./use-machine-order.ts";
import { useTerminals, type DocHeard } from "./use-terminals.ts";
import { useResumeEnds } from "./resume-ends.ts";
import { useNoticeOpen } from "../push/notice-open.ts";
import { usePushPresence } from "../push/use-push-presence.ts";
import { PromptAnswerBanner } from "../push/prompt-answer-banner.tsx";
import { CATCHER_ATTRIBUTES, type DropReason, useTypeAhead } from "./use-type-ahead.ts";

export interface WorkspaceProps {
  readonly connection: HcConnection;
}

/** The live terminals of one core: the desktop shell from `md` up, the phone navigation below. */
export function Workspace({ connection }: WorkspaceProps) {
  // The feed comes before the machine list the layout documents need, so its doc events reach them through a ref.
  const heardLayout = useRef<(machine: string | null, version: number) => void>(() => undefined);
  const heardOrder = useRef<(version: number) => void>(() => undefined);
  const onDoc = useCallback<DocHeard>((machine, name, version) => {
    if (name === LAYOUT_DOC) heardLayout.current(machine, version);
    if (name === ORDER_DOC && machine === null) heardOrder.current(version);
  }, []);
  const fed = useTerminals(connection, onDoc);
  useResumeEnds(connection);
  const {
    entries: listed,
    terminals,
    refresh,
    listError,
    views,
    retry,
    listed: machineReads,
  } = useMachines(connection, fed.terminals);
  const { layouts, heard } = useLayoutDocs(connection, views);
  const gitOf = useGitFacts(connection, views);
  heardLayout.current = heard;
  const order = useMachineOrder(connection, listed);
  heardOrder.current = order.heard;
  const entries = order.entries;
  const toasts = useToastManager();
  const { move: saveMove } = order;
  const moveMachine = useCallback(
    function move(core: string, to: number): Promise<boolean> {
      return saveMove(core, to).catch((cause: unknown) => {
        const id = toasts.add({
          type: "error",
          ...orderNotSaved(cause),
          actionProps: {
            children: "Retry",
            onClick: () => {
              toasts.close(id);
              void move(core, to);
            },
          },
        });
        return false;
      });
    },
    [saveMove, toasts],
  );
  const failed = useCallback(
    (message: string) => toasts.add({ type: "error", title: "The layout was not saved", description: message }),
    [toasts],
  );
  const told = useCallback((message: string) => toasts.add({ type: "info", title: message }), [toasts]);
  const unsaved = useCallback(
    (message: string) =>
      toasts.add({
        type: "error",
        title: "The tab order was not saved",
        description: `${message.replace(/\.$/, "")}. This window keeps it until it reloads.`,
      }),
    [toasts],
  );
  const layout = useLayout(
    connection.hello.core.id,
    layouts,
    fed.loaded ? terminals : [],
    failed,
    told,
    unsaved,
    machineReads > 0,
  );
  // A session that ends is dropped from the layout once, by whichever automatic signal comes first: closing it ends and
  // removes it (#409), so its view's end and the dead-pane check both report it. A refused drop keeps the pane, showing
  // the ended session, as for a program that exits; a second drop would be refused again, toast again and move the view.
  const droppedOnce = useRef(new Set<string>());
  useEffect(() => {
    // An address listed live again is a new session in it, whose end is dropped again.
    for (const terminal of terminals) if (terminal.state === "live") droppedOnce.current.delete(terminal.address);
  }, [terminals]);
  const { dropPane } = layout;
  const dropEnded = useCallback(
    (address: string): void => {
      if (droppedOnce.current.has(address)) return;
      droppedOnce.current.add(address);
      dropPane(address);
    },
    [dropPane],
  );
  useDeadPanes(connection, layout.tabs, fed.loaded ? terminals : null, views, machineReads, dropEnded);
  const narrow = useNarrow();
  const ids = useMemo(() => machineIds(views), [views]);
  // The phone's open terminal is kept by machine id like a tab, so a rename keeps it open at the new address.
  const [phoneKey, setPhoneKey] = useState<string | null>(null);
  const phoneOpen = phoneKey === null ? null : (tabAddress(phoneKey, ids) ?? null);
  const showOnPhone = useCallback((address: string) => setPhoneKey(tabKey(address, ids)), [ids]);
  const [palette, setPalette] = useState(false);
  const [ask, setAsk] = useState<SessionAsk | null>(null);
  const [adding, setAdding] = useState(false);
  useActionHandler("app", (action) => {
    if (action !== "app.palette") return false;
    setPalette((shown) => !shown);
    return true;
  });
  const { openTerminal: openInLayout } = layout;
  const opened = useCallback(
    (address: string): void => {
      openInLayout(address);
      showOnPhone(address);
    },
    [openInLayout, showOnPhone],
  );
  const [closingTab, setClosingTab] = useState<string | null>(null);
  const notSent = useCallback(
    (reason: DropReason) =>
      toasts.add({
        type: "error",
        title: "What you typed was not sent",
        description:
          reason === "failed"
            ? "The new terminal did not start, so the keys typed for it went nowhere."
            : "The new terminal took too long to open, so the keys typed for it were dropped.",
      }),
    [toasts],
  );
  const typeAhead = useTypeAhead(notSent);
  const runs = useMachineRuns(connection, opened, refresh, typeAhead);
  const [splits] = useState(() => new SplitChain());
  // A split key reads focus from the last render; the chain hands a landed split's pane on until this render shows it.
  const shownTab = layout.active?.key;
  const shownPane = layout.focused?.id;
  useEffect(() => {
    if (shownTab !== undefined && shownPane !== undefined) splits.shown(shownTab, shownPane);
  }, [splits, shownTab, shownPane]);
  const inView = narrow ? phoneOpen : (layout.focused?.address ?? null);
  const newTerminal = (): void => runs.start(runParamsFor(terminals.find((terminal) => terminal.address === inView)));
  const split = (axis: Axis, target?: PaneTarget): void => {
    const from =
      target === undefined
        ? inView
        : layout.tabs.find((tab) => tab.key === target.tab)?.panes.find((pane) => pane.id === target.pane)?.address;
    const near = terminals.find((terminal) => terminal.address === from);
    const tab = target === undefined ? layout.active : layout.tabs.find((each) => each.key === target.tab);
    const focused = layout.focused?.id;
    if (tab === undefined || tab === null || tab.transient || focused === undefined) {
      return runs.start(runParamsFor(near), (address) => layout.split(axis, address, target));
    }
    return chainedSplit(
      splits,
      { tab: tab.key, focused, source: target?.pane ?? null },
      (place, fail) => runs.start(runParamsFor(near), place, fail),
      (address, pane, made) => layout.split(axis, address, { tab: tab.key, pane }, made),
    );
  };
  const closeTab = (key: string): void => {
    const tab = layout.tabs.find((each) => each.key === key);
    const shown = tab?.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])) ?? [];
    const [only] = shown;
    if (shown.length === 1 && only !== undefined) setAsk({ kind: "close", address: only });
    else if (shown.length > 1) setClosingTab(key);
    else layout.closeTab(key);
  };
  const onEnd = (address: string, end: TerminalEnd): void => {
    // An End of this session drops its pane only once it has removed the terminal (see afterEnd).
    if (closesTab(end)) afterEnd(address, () => dropEnded(address));
  };
  const closing = layout.tabs.find((tab) => tab.key === closingTab);
  const phoneTab = phoneOpen === null ? null : findTerminal(layout.tabs, phoneOpen);
  const phonePanes = phoneTab?.tab.panes.flatMap((pane) => (pane.address === null ? [] : [pane.address])) ?? [];
  usePushPresence(inView);
  useNoticeOpen(connectionStore.settings.mode === "relay" ? connectionStore.settings.hostId : undefined, opened);
  const onPalette = (): void => setPalette(true);
  const onSession: SessionVerb = (verb) => {
    if (inView === null) return false;
    setAsk({ kind: verb, address: inView });
    return true;
  };
  const done = useCallback(() => setAsk(null), []);
  const pin = useCallback<PinTerminal>(
    (address, pinned) => {
      const labels = { [PIN_LABEL]: pinned ? "1" : "" };
      connection.call("terminal.label", { terminal: address, labels }).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        toasts.add({ type: "error", title: pinned ? "Could not pin it" : "Could not unpin it", description: reason });
      });
    },
    [connection, toasts],
  );

  const openAddMachine = useCallback(() => setAdding(true), []);
  const terminalsLoaded = fed.loaded;
  const machinesListed = machineReads > 0 || listError !== undefined;
  const machines = useMemo(
    () => ({ entries, terminalsLoaded, machinesListed, listError, openAddMachine, views, retry, moveMachine, ...runs }),
    [entries, terminalsLoaded, machinesListed, listError, openAddMachine, views, retry, moveMachine, runs],
  );
  return (
    <MachinesContext value={machines}>
      <GitFactsContext value={gitOf}>
        <PinContext value={pin}>
          <SessionContext value={setAsk}>
            {narrow ? (
              <PhoneShell
                connection={connection}
                terminals={terminals}
                open={phoneOpen}
                panes={phonePanes}
                onOpen={showOnPhone}
                onBack={() => setPhoneKey(null)}
                onNew={() => newTerminal()}
                onPalette={onPalette}
                onSession={onSession}
              />
            ) : (
              <DesktopShell
                connection={connection}
                terminals={terminals}
                loaded={fed.loaded}
                layout={layout}
                onNew={() => newTerminal()}
                onSplit={split}
                onCloseTab={closeTab}
                onClosePane={(address) => setAsk({ kind: "close", address })}
                onEnd={onEnd}
                onPalette={onPalette}
                onSession={onSession}
              />
            )}
          </SessionContext>
        </PinContext>
        <PromptAnswerBanner />
        <textarea
          ref={typeAhead.catcher}
          {...CATCHER_ATTRIBUTES}
          aria-label="New terminal starting: what you type goes to it"
          tabIndex={-1}
          className="sr-only"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <AddMachineDialog open={adding} onClose={() => setAdding(false)} />
        <SessionDialogs
          connection={connection}
          terminals={terminals}
          ask={ask}
          onDone={done}
          onDrop={layout.dropPane}
        />
        {closing === undefined ? null : (
          <CloseTabDialog
            connection={connection}
            terminals={terminals}
            tab={closing}
            onClosed={() => layout.closeTab(closing.key)}
            onDone={() => setClosingTab(null)}
          />
        )}
        {palette ? (
          <Palette
            terminals={terminals}
            host={connection.hello.core.name}
            route={connectionStore.settings.mode === "relay" ? "relay" : "loopback"}
            actions={availableActions(narrow ? "phone" : "desktop", inView !== null, layout.active?.readOnly ?? null, {
              keys: layout.tabs.map((tab) => tab.key),
              active: layout.active?.key ?? null,
            })}
            onOpenTerminal={opened}
            onClose={() => setPalette(false)}
          />
        ) : null}
      </GitFactsContext>
    </MachinesContext>
  );
}
