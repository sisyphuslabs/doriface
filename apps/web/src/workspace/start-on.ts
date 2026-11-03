import { HcRpcError, type TerminalRunParams } from "@doriface/protocol";

export interface RunFailure {
  readonly machine: string;
  readonly kind: string;
  readonly message: string;
}

export type Started =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly failure: RunFailure };

const ADVICE: Readonly<Record<string, (machine: string) => string>> = {
  unavailable: (machine) => `${machine} is not connected`,
  machine_unknown: (machine) => `${machine} is no longer added here`,
};

/**
 * Starts a shell on an added machine. hc's refusal (the machine is unavailable or no longer added)
 * comes back as a failure naming the machine; anything else, such as a closed connection, still throws.
 */
export async function startOn(
  run: (params: { readonly on: string }) => Promise<{ readonly address: string }>,
  machine: string,
): Promise<Started> {
  try {
    return { ok: true, address: (await run({ on: machine })).address };
  } catch (error) {
    if (!(error instanceof HcRpcError)) throw error;
    const message = ADVICE[error.kind]?.(machine) ?? error.message;
    return { ok: false, failure: { machine, kind: error.kind, message } };
  }
}

/**
 * New terminal anywhere: `on` names an added machine, else it starts on this one (`localName`). Every failure comes
 * back as one naming the machine, a closed connection included, so the caller reports it instead of dropping it.
 */
export async function startTerminal(
  run: (params: TerminalRunParams) => Promise<{ readonly address: string }>,
  params: TerminalRunParams,
  localName: string,
): Promise<Started> {
  const machine = params.on ?? localName;
  try {
    return { ok: true, address: (await run(params)).address };
  } catch (error) {
    if (error instanceof HcRpcError) {
      return {
        ok: false,
        failure: { machine, kind: error.kind, message: ADVICE[error.kind]?.(machine) ?? error.message },
      };
    }
    return {
      ok: false,
      failure: { machine, kind: "connection", message: error instanceof Error ? error.message : String(error) },
    };
  }
}
