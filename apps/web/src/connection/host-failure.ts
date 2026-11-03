import { DeviceNotPairedError } from "./connect.ts";

const BY_CODE: Readonly<Record<number, string>> = {
  4400: "The secure connection to your host failed. If the host was set up again, pair this device again.",
  4403: "Your host's identity was refused. Restart doriface-host on it.",
  4404: "Your host isn't connected right now. Check that its computer is awake and doriface-host is running.",
  4408: "Your host didn't answer in time. It may be busy or on a slow network.",
  4429: "There were too many attempts in a short time. Wait a minute.",
};

const FALLBACK = "Your host isn't answering. Check that its computer is on and doriface-host is running.";

/** Why this device cannot reach its host, in plain words: the close code decides, never the transport's message. */
export function hostFailure(error: Error): string {
  if (error instanceof DeviceNotPairedError) return error.message;
  const code = "code" in error && typeof error.code === "number" ? error.code : undefined;
  return (code === undefined ? undefined : BY_CODE[code]) ?? FALLBACK;
}
