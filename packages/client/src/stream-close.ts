import { isJsonObject, parseJson, type JsonValue } from "@doriface/protocol";

/** Why a stream ended: the program ended (`core`), this viewer detached, or the connection went away. */
export interface StreamClose {
  readonly by: "core" | "viewer" | "connection";
  readonly reason: string;
  readonly exit_code: number | null;
  readonly signal: number | null;
  readonly finished_ms: number | null;
  readonly error?: Error;
}

const NO_EXIT = { exit_code: null, signal: null, finished_ms: null } as const;

export function connectionClose(error: Error | undefined): StreamClose {
  const ended = { by: "connection", reason: "connection_closed", ...NO_EXIT } as const;
  return error === undefined ? ended : { ...ended, error };
}

/** A core CLOSE is empty when it confirms a viewer's detach, and carries the exit JSON when the program ended. */
export function closeFromPayload(payload: Uint8Array, detaching: boolean): StreamClose {
  if (payload.byteLength === 0) {
    return detaching ? { by: "viewer", reason: "detached", ...NO_EXIT } : { by: "core", reason: "closed", ...NO_EXIT };
  }
  const reason = parseReason(payload);
  if (!isJsonObject(reason)) return { by: "core", reason: "unknown", ...NO_EXIT };
  return {
    by: "core",
    reason: typeof reason["reason"] === "string" ? reason["reason"] : "unknown",
    exit_code: numberOrNull(reason["exit_code"]),
    signal: numberOrNull(reason["signal"]),
    finished_ms: numberOrNull(reason["finished_ms"]),
  };
}

function parseReason(payload: Uint8Array): JsonValue | undefined {
  try {
    return parseJson(new TextDecoder().decode(payload));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function numberOrNull(value: JsonValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}
