/**
 * A private state file or folder this host will not trust, on any platform: its message names the file and the fix.
 * It is no refused command line, so the CLI prints only the message, never the usage.
 */
export class PrivateStateRefused extends Error {
  override readonly name = "PrivateStateRefused";
}

/** Distinct from 2 (a command line the CLI does not accept) and the startup codes; 1 is a failed command. */
export const PRIVATE_STATE_REFUSED_EXIT_CODE = 1;
