const BROWSERS = [
  [/Edg\//, "Edge"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
] as const;

const SYSTEMS = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
] as const;

const first = (table: readonly (readonly [RegExp, string])[], userAgent: string): string | undefined =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1];

export function deviceName(userAgent: string = navigator.userAgent): string {
  const browser = first(BROWSERS, userAgent) ?? "Browser";
  const system = first(SYSTEMS, userAgent);
  return system === undefined ? browser : `${browser} on ${system}`;
}
