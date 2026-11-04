import { cn } from "../lib/cn.ts";

/** The avatar hues, in the order a new space takes the least used one. */
export const AVATAR_COLORS = ["teal", "orange", "blue", "violet", "green", "pink"] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

const FILL: Readonly<Record<AvatarColor, string>> = {
  teal: "bg-avatar-teal",
  orange: "bg-avatar-orange",
  blue: "bg-avatar-blue",
  violet: "bg-avatar-violet",
  green: "bg-avatar-green",
  pink: "bg-avatar-pink",
};

export interface SpaceAvatarProps {
  readonly name: string;
  readonly color: AvatarColor;
  readonly className?: string;
}

/** A space's stable mark: its initial on its colour. Decorative: the space's name is always beside it or its label. */
export function SpaceAvatar({ name, color, className }: SpaceAvatarProps) {
  const initial = [...name.replace(/^[^\p{L}\p{N}]+/u, "")][0]?.toUpperCase() ?? "~";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4.5 shrink-0 items-center justify-center rounded-xs text-2xs leading-none font-bold text-avatar-ink",
        FILL[color],
        className,
      )}
    >
      {initial}
    </span>
  );
}
