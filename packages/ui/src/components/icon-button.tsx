import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { Button, type ButtonProps } from "./button.tsx";
import { Tooltip } from "./tooltip.tsx";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "size"> {
  /** Names the action for assistive tech and the tooltip. Required: icon-only controls need words. */
  readonly label: string;
  readonly icon: ReactNode;
  readonly keys?: readonly string[];
  readonly size?: "sm" | "md";
  /** Pressed state for toggles, e.g. the sidebar switch. */
  readonly pressed?: boolean;
}

const SIZE = { sm: "size-(--control-sm) px-0", md: "size-(--control) px-0" } as const;

export function IconButton({
  label,
  icon,
  keys,
  size = "sm",
  pressed,
  className,
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip label={label} {...(keys === undefined ? {} : { keys })}>
      <Button
        {...props}
        variant={variant}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(SIZE[size], pressed === true && "bg-selected text-foreground", className)}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}
