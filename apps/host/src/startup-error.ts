/**
 * Why doriface-host stopped before it was serving. The CLI prints one `startup-error` line for it and exits with the
 * code's own exit status, so a launcher (the desktop app) reads the reason instead of parsing prose or usage text.
 */
export type StartupErrorCode =
  | "hc-binary-missing"
  | "hc-version-failed"
  | "hc-too-old"
  | "port-in-use"
  | "permission-denied"
  | "already-running"
  | "startup-failed";

/** Distinct from 2, which stays the exit status of a command line the CLI does not accept. */
export const STARTUP_EXIT_CODES: Readonly<Record<StartupErrorCode, number>> = {
  "startup-failed": 3,
  "hc-binary-missing": 4,
  "hc-version-failed": 5,
  "port-in-use": 6,
  "permission-denied": 7,
  "already-running": 8,
  // 9 is the state lock's (LOCK_WEDGED_EXIT_CODE).
  "hc-too-old": 10,
};

export interface StartupErrorDetail {
  /** The file it tried: the hc binary, or the state dir another host serves. */
  readonly path?: string | undefined;
  /** The `host:port` it tried to listen on. */
  readonly address?: string | undefined;
}

export class StartupError extends Error {
  override readonly name = "StartupError";
  readonly code: StartupErrorCode;
  readonly detail: StartupErrorDetail;

  constructor(code: StartupErrorCode, message: string, detail: StartupErrorDetail = {}, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.detail = detail;
  }
}

/** The stderr line prefix; the rest of the line is one JSON object. */
export const STARTUP_ERROR_PREFIX = "doriface-host startup-error ";

export interface StartupErrorReport extends StartupErrorDetail {
  readonly code: StartupErrorCode;
  readonly message: string;
}

export function startupErrorLine(error: StartupError): string {
  const report: StartupErrorReport = { code: error.code, message: error.message, ...error.detail };
  return `${STARTUP_ERROR_PREFIX}${JSON.stringify(report)}`;
}

const CODES = new Set<string>(Object.keys(STARTUP_EXIT_CODES));
const isStartupErrorCode = (value: unknown): value is StartupErrorCode => typeof value === "string" && CODES.has(value);
const optionalString = (value: unknown): boolean => value === undefined || typeof value === "string";

/** The report on a `startup-error` line, or undefined for any other line. */
export function parseStartupErrorLine(line: string): StartupErrorReport | undefined {
  if (!line.startsWith(STARTUP_ERROR_PREFIX)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(STARTUP_ERROR_PREFIX.length));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const code: unknown = Reflect.get(value, "code");
  const message: unknown = Reflect.get(value, "message");
  const path: unknown = Reflect.get(value, "path");
  const address: unknown = Reflect.get(value, "address");
  if (!isStartupErrorCode(code) || typeof message !== "string") return undefined;
  if (!optionalString(path) || !optionalString(address)) return undefined;
  return {
    code,
    message,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof address === "string" ? { address } : {}),
  };
}

export const errnoOf = (error: unknown): string | undefined => {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : undefined;
};

/** A listener that could not bind `address`: in use, refused, or anything else. */
export function listenError(error: unknown, address: string): StartupError {
  const errno = errnoOf(error);
  const reason = error instanceof Error ? error.message : String(error);
  if (errno === "EADDRINUSE") {
    return new StartupError("port-in-use", `${address} is already in use (${reason})`, { address }, { cause: error });
  }
  if (errno === "EACCES" || errno === "EPERM") {
    return new StartupError(
      "permission-denied",
      `may not listen on ${address} (${reason})`,
      { address },
      { cause: error },
    );
  }
  return new StartupError("startup-failed", `cannot listen on ${address}: ${reason}`, { address }, { cause: error });
}

export const asStartupError = (error: unknown): StartupError =>
  error instanceof StartupError
    ? error
    : new StartupError("startup-failed", error instanceof Error ? error.message : String(error), {}, { cause: error });
