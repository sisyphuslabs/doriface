import { Spinner, StatusBarItem } from "@doriface/ui";
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { staysOnThisComputer } from "../connection/settings.ts";
import { connectionStore, useConnection } from "../connection/store.ts";
import { useOnline } from "../pwa/use-online.ts";

function useSecondsUntil(at: number | null, longest: number): number | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (at === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [at]);
  return at === null ? null : Math.max(1, Math.min(longest, Math.ceil((at - now) / 1000)));
}

export interface ConnectionNotice {
  /** The short words: a status bar item. */
  readonly label: string;
  /** The whole sentence: a tooltip, or the phone terminal's notice line. */
  readonly detail: string;
  /** Offline waits on the network, not on a timer: a still glyph, not a spinner. */
  readonly offline: boolean;
}

/** What to say about the workspace's connection while it is not usable, or null while it is. */
export function useConnectionNotice(): ConnectionNotice | null {
  const state = useConnection();
  const online = useOnline();
  const failed = state.phase === "failed" ? state : null;
  const seconds = useSecondsUntil(failed?.retryAt ?? null, Math.ceil((failed?.retryInMs ?? 0) / 1000));
  if (!online && !staysOnThisComputer(connectionStore.settings))
    return { label: "Offline", detail: "Offline. Reconnects when the network is back.", offline: true };
  if (state.phase === "open" || state.phase === "unconfigured" || state.phase === "host-failed" || state.stale === null)
    return null;
  const label = seconds === null ? "Reconnecting…" : `Reconnecting in ${seconds} s`;
  return { label, detail: failed === null ? label : `${label}: ${failed.error.message}`, offline: false };
}

const glyph = (notice: ConnectionNotice) => (notice.offline ? <WifiOff aria-hidden /> : <Spinner />);

/** Status bar item while the workspace on screen is offline or waits for its connection; typing meanwhile is kept. */
export function ReconnectStatus() {
  const notice = useConnectionNotice();
  if (notice === null) return null;
  return (
    <span role="status" className="flex min-w-0" title={notice.detail}>
      <StatusBarItem icon={glyph(notice)}>
        <span className="text-foreground">{notice.label}</span>
      </StatusBarItem>
    </span>
  );
}

/** The phone terminal has no status bar: the same notice as one line under its header, only while there is one. */
export function ConnectionLine() {
  const notice = useConnectionNotice();
  if (notice === null) return null;
  return (
    <p
      role="status"
      className="flex shrink-0 items-start gap-2 border-b border-border bg-chrome px-4 py-2 text-sm text-foreground [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      {glyph(notice)}
      {/* The sentence is required content (DESIGN.md 5 (e)): it wraps at narrow widths rather than losing its end. */}
      <span className="min-w-0 text-pretty break-words" title={notice.detail}>
        {notice.offline ? notice.detail : notice.label}
      </span>
    </p>
  );
}
