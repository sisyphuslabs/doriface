import { Button, Notice } from "@doriface/ui";
import type { ReactNode } from "react";

export interface RegionCrashProps {
  readonly title: string;
  readonly children?: ReactNode;
  readonly onRetry: () => void;
}

/** One part of the app that could not be drawn, said in its own place; everything around it keeps working. */
export function RegionCrash({ title, children, onRetry }: RegionCrashProps) {
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
      </Notice>
    </div>
  );
}
