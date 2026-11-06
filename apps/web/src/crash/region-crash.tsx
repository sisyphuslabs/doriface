import { Button, Notice } from "@doriface/ui";
import type { ReactNode } from "react";
import { CopyDetails } from "./copy-details.tsx";

export interface RegionCrashProps {
  readonly title: string;
  readonly error: unknown;
  readonly children?: ReactNode;
  readonly onRetry: () => void;
}

/**
 * One part of the app that could not be drawn, said in its own place with Try again and its own Copy details, so a
 * phone with no developer tools can still report it; everything around it keeps working.
 */
export function RegionCrash({ title, error, children, onRetry }: RegionCrashProps) {
  return (
    <div className="p-3">
      <Notice
        tone="error"
        title={title}
        actions={
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {children}
        <div className="mt-2">
          <CopyDetails error={error} size="sm" />
        </div>
      </Notice>
    </div>
  );
}
