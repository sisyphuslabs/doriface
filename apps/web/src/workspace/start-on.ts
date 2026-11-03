import { HcRpcError } from "@doriface/protocol";

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
