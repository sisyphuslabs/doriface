import type { ReactNode } from "react";
import { CrashProbe } from "./crash-probe.ts";
import { RegionCrash } from "./region-crash.tsx";
import { RenderBoundary } from "./render-boundary.tsx";

export interface RegionBoundaryProps {
  /** The region's name for the e2e crash probe (crash/crash-probe.ts). */
  readonly region: string;
  /** What could not be drawn, as one sentence. */
  readonly title: string;
  /** What still works, as one sentence. */
  readonly detail: string;
  readonly children?: ReactNode;
}

/** A part of the app that can fail alone: a render error inside it is said in its place, with Try again. */
export function RegionBoundary({ region, title, detail, children }: RegionBoundaryProps) {
  return (
    <RenderBoundary
      fallback={(error, retry) => (
        <RegionCrash title={title} error={error} onRetry={retry}>
          {detail}
        </RegionCrash>
      )}
    >
      <CrashProbe region={region} />
      {children}
    </RenderBoundary>
  );
}
