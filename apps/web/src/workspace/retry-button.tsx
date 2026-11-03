import { Button, type ButtonProps } from "@doriface/ui";
import { useState } from "react";

export interface RetryButtonProps extends Pick<ButtonProps, "size" | "className"> {
  readonly onRetry: () => Promise<void>;
}

/** Try again for a machine: busy until the dial and the re-read settle, so repeated clicks send one dial at a time. */
export function RetryButton({ onRetry, size, className }: RetryButtonProps) {
  const [trying, setTrying] = useState(false);
  const tryAgain = (): void => {
    setTrying(true);
    void onRetry().finally(() => setTrying(false));
  };
  return (
    <Button
      variant="secondary"
      loading={trying}
      onClick={tryAgain}
      {...(size === undefined ? {} : { size })}
      {...(className === undefined ? {} : { className })}
    >
      Try again
    </Button>
  );
}
