import { DEFAULT_EXTRA_KEYS, ExtraKeysBar } from "@doriface/ui";
import type { ReactNode } from "react";

/** The phone screen, composed from the app's own keys bar with fixture data: no host, no network. */
export function PhoneMock(): ReactNode {
  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 text-sm">
        <span aria-hidden className="text-muted-foreground">
          ‹
        </span>
        <span className="font-semibold">2</span>
        <span className="text-muted-foreground">Home</span>
        <span aria-hidden className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-status-done-text">●</span>1<span className="text-status-working-text">◐</span>2
          <span>○</span>3
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-2 text-[15px] leading-7 [color:var(--term-fg)] [font-family:var(--font-term)]">
        <div className="whitespace-pre-wrap break-words">
          <span className="text-muted-foreground">$ </span>printf &apos;keys-%s\n&apos; &apos;a line to select
          from&apos;
        </div>
        <div className="whitespace-pre-wrap break-words">keys-a line to select from</div>
        <div className="whitespace-pre-wrap">
          <span className="text-muted-foreground">$ </span>
        </div>
      </div>
      <div className="shrink-0 px-2 pb-3">
        <ExtraKeysBar keys={DEFAULT_EXTRA_KEYS} onKey={() => {}} onPad={() => {}} onPaste={() => {}} />
      </div>
    </div>
  );
}
