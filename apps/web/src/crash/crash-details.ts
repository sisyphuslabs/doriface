/** What a render error's Copy details holds: enough to file a bug, and nothing a terminal printed. */
export interface CrashContext {
  /** The page's path. Its query and fragment are dropped here: a pairing link's secret lives in the fragment. */
  readonly route: string;
  readonly userAgent: string;
  readonly at: Date;
}

const STACK_FRAMES = 12;
const THROWN_VALUE_CHARS = 500;

function headline(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  const text = typeof error === "string" ? error : String(error);
  const cut = text.length > THROWN_VALUE_CHARS ? `${text.slice(0, THROWN_VALUE_CHARS)}…` : text;
  return `Thrown value (${typeof error}): ${cut}`;
}

/** A stack frame in V8's form ("at fn (url:line:col)") or WebKit's and Firefox's ("fn@url:line:col", "@url:line:col"). */
const isFrame = (line: string): boolean => line.startsWith("at ") || /@.*:\d+:\d+$/.test(line);

function frames(error: unknown): string[] {
  if (!(error instanceof Error) || error.stack === undefined) return [];
  return error.stack
    .split("\n")
    .filter((line) => isFrame(line.trimStart()))
    .slice(0, STACK_FRAMES);
}

export function crashDetails(error: unknown, context: CrashContext): string {
  const route = context.route.split(/[?#]/, 1)[0] ?? "";
  return [
    headline(error),
    ...frames(error),
    "",
    `Route: ${route}`,
    `Browser: ${context.userAgent}`,
    `Time: ${context.at.toISOString()}`,
  ].join("\n");
}
