import { chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  closeHandle,
  currentUserSid,
  OPEN_EXISTING,
  openFile,
  READ_CONTROL,
  readSddl,
  resolveSidAlias,
} from "../state/win32/native.ts";
import { parseSddl } from "../state/win32/sddl.ts";

const WINDOWS = process.platform === "win32";

/** The POSIX modes these tests open a private file to, and the Windows account each one stands for. */
const OTHERS = { "644": "S-1-1-0", "640": "S-1-5-32-545", "604": "S-1-5-11" } as const;
export type ExposedMode = keyof typeof OTHERS;

/** The text either platform's refusal carries: POSIX names the mode bits, Windows the accounts. */
export const EXPOSED_REFUSAL = /readable by other users|can be read or changed by other accounts/;

function icacls(...args: string[]): void {
  const exe = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "icacls.exe");
  const run = Bun.spawnSync([exe, ...args]);
  if (run.exitCode !== 0) throw new Error(`icacls ${args.join(" ")}: ${run.stdout.toString()}${run.stderr.toString()}`);
}

/**
 * Opens `path` to others the platform's way: the POSIX mode on POSIX; on Windows a read grant to the account the mode
 * stands for (644 Everyone, 640 Users, 604 Authenticated Users).
 */
export function exposeToOthers(path: string, mode: ExposedMode): void {
  if (WINDOWS) icacls(path, "/grant", `*${OTHERS[mode]}:R`);
  else chmodSync(path, Number.parseInt(mode, 8));
}

/** Undoes {@link exposeToOthers}, leaving the file private again. */
export function makePrivateAgain(path: string, mode: ExposedMode): void {
  if (WINDOWS) icacls(path, "/remove:g", `*${OTHERS[mode]}`);
  else chmodSync(path, 0o600);
}

/** Whether `path` is private the platform's way: mode 600, or an exact protected owner-only DACL. */
export function isOwnerOnly(path: string): boolean {
  if (!WINDOWS) return (statSync(path).mode & 0o777) === 0o600;
  const handle = openFile(path, { access: READ_CONTROL, share: 7, disposition: OPEN_EXISTING, flags: 0 });
  try {
    const user = currentUserSid();
    const { owner, dacl, protected: isProtected } = parseSddl(readSddl(handle), resolveSidAlias);
    return (
      owner === user &&
      isProtected &&
      dacl?.length === 1 &&
      dacl[0]?.type === "A" &&
      dacl[0].sid === user &&
      dacl[0].flags === ""
    );
  } finally {
    closeHandle(handle);
  }
}
