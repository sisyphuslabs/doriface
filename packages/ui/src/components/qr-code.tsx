import { cn } from "../lib/cn.ts";

export interface QrCodeProps {
  /** Square module matrix, true = dark. Encoding happens elsewhere; this only draws. */
  readonly modules: readonly (readonly boolean[])[];
  readonly label: string;
  readonly className?: string;
}

/** Draws a QR matrix as one SVG path, ink on white in both themes so every camera can read it. */
export function QrCode({ modules, label, className }: QrCodeProps) {
  const size = modules.length;
  let path = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    });
  });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size + 8} ${size + 8}`}
      shapeRendering="crispEdges"
      className={cn("aspect-square rounded-lg bg-white", className)}
    >
      <path d={path} fill="#111111" />
    </svg>
  );
}
