import { Input, SegmentedControl, SettingRow } from "@doriface/ui";
import { useState } from "react";
import { type ConnectionMode, type ConnectionSettings, DEFAULT_RELAY_URL, DEV_BUILD } from "../connection/settings.ts";
import { connectionStore } from "../connection/store.ts";

const MODES = [
  { value: "relay", label: "Relay" },
  { value: "loopback", label: "Loopback dev" },
] as const;

type TextField = "relayUrl" | "directUrl" | "loopbackUrl" | "token";

/** The production relay as people read it: its host name, without the scheme. */
const RELAY_HOST = new URL(DEFAULT_RELAY_URL).host;

/**
 * Relay (end-to-end encrypted, racing a direct LAN path) or the plaintext loopback dev gateway. A release build always
 * reaches the production relay: it shows that relay without a field to change it, and offers no loopback switch.
 */
export function ConnectionSection() {
  const [draft, setDraft] = useState<ConnectionSettings>(connectionStore.settings);
  const commit = (next: ConnectionSettings): void => {
    setDraft(next);
    connectionStore.update(next);
  };
  const row = (id: TextField, title: string, description: string, secret = false) => (
    <SettingRow
      id={id}
      title={title}
      description={description}
      control={
        <Input
          aria-label={title}
          mono
          type={secret ? "password" : "text"}
          spellCheck={false}
          autoComplete="off"
          value={draft[id]}
          className="w-full sm:w-64"
          onValueChange={(value: string) => setDraft((prev) => ({ ...prev, [id]: value }))}
          onBlur={() => {
            if (draft[id] !== connectionStore.settings[id]) commit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(draft);
          }}
        />
      }
    />
  );

  if (!DEV_BUILD) {
    return draft.mode === "relay" ? (
      <>
        <SettingRow
          title="Relay"
          description="Works from anywhere and only forwards encrypted traffic."
          control={<span className="font-mono text-sm text-muted-foreground">{RELAY_HOST}</span>}
        />
        {row("directUrl", "Direct address", "The host on your network; preferred when it answers within 300 ms.")}
      </>
    ) : (
      <>
        {row("loopbackUrl", "Gateway", "The /v1/hc address doriface-host prints.")}
        {row("token", "Token", "Printed by doriface-host --print-token.", true)}
      </>
    );
  }

  return (
    <>
      <SettingRow
        title="Connect through"
        description={
          draft.mode === "relay"
            ? "The relay works from anywhere and only forwards encrypted traffic."
            : "Talks to doriface-host on this machine in plain text. For development only."
        }
        control={
          <SegmentedControl<ConnectionMode>
            label="Connect through"
            options={MODES}
            value={draft.mode}
            onValueChange={(mode) => commit({ ...draft, mode })}
          />
        }
      />
      {draft.mode === "relay" ? (
        <>
          {row("relayUrl", "Relay address", "Change it only for a relay you run yourself.")}
          {row("directUrl", "Direct address", "The host on your network; preferred when it answers within 300 ms.")}
        </>
      ) : (
        <>
          {row("loopbackUrl", "Gateway", "The /v1/hc address doriface-host prints.")}
          {row("token", "Token", "Printed by doriface-host --print-token.", true)}
        </>
      )}
    </>
  );
}
