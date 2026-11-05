/**
 * How private state opens a file on Windows without losing the reason it failed (#464): NtCreateFile returns its
 * NTSTATUS, so the cause is read from the call's own result. CreateFileW plus a later GetLastError reads a thread value
 * that the runtime can overwrite between two FFI calls (Windows arm64 read 0). This module is the platform-free part:
 * the CreateFileW-equivalent request, the NT path, the status-to-Win32 code mapping and the bounded wait on contention.
 */

export class Win32Error extends Error {
  override readonly name = "Win32Error";
  readonly call: string;
  readonly code: number;
  constructor(call: string, code: number) {
    super(`${call} failed (Windows error ${String(code)})`);
    this.call = call;
    this.code = code;
  }
}

export interface OpenOptions {
  readonly access: number;
  readonly share: number;
  readonly disposition: number;
  readonly flags: number;
  /** For CREATE_NEW: the exact descriptor the new object is created with. */
  readonly descriptor?: bigint;
}

export const STATUS_SHARING_VIOLATION = 0xc000_0043;
export const STATUS_FILE_LOCK_CONFLICT = 0xc000_0054;
export const STATUS_OBJECT_NAME_COLLISION = 0xc000_0035;
export const ERROR_FILE_EXISTS = 80;

/** How long a file another process holds open without sharing is waited for before its refusal is thrown. */
export const CONTENTION_WAIT_MS = 1000;
const CONTENTION_POLL_MS = 5;

const SYNCHRONIZE = 0x0010_0000;
const FILE_READ_ATTRIBUTES = 0x80;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const FILE_FLAG_BACKUP_SEMANTICS = 0x0200_0000;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x0020_0000;
const FILE_FLAG_WRITE_THROUGH = 0x8000_0000;
const FILE_WRITE_THROUGH = 0x2;
const FILE_SYNCHRONOUS_IO_NONALERT = 0x20;
const FILE_NON_DIRECTORY_FILE = 0x40;
const FILE_OPEN_FOR_BACKUP_INTENT = 0x4000;
const FILE_OPEN_REPARSE_POINT = 0x0020_0000;

/** CreateFileW's creation disposition -> NtCreateFile's (CREATE_NEW, CREATE_ALWAYS, OPEN_EXISTING, OPEN_ALWAYS, TRUNCATE_EXISTING). */
const DISPOSITION: Readonly<Record<number, number>> = { 1: 2, 2: 5, 3: 1, 4: 3, 5: 4 };

export interface NtRequest {
  readonly access: number;
  readonly attributes: number;
  readonly share: number;
  readonly disposition: number;
  readonly createOptions: number;
}

/** The NtCreateFile arguments CreateFileW would pass for `options` (synchronous I/O, no overlapped handle). */
export function ntRequest(options: OpenOptions): NtRequest {
  const disposition = DISPOSITION[options.disposition];
  if (disposition === undefined) throw new RangeError(`unknown creation disposition ${String(options.disposition)}`);
  const backup = (options.flags & FILE_FLAG_BACKUP_SEMANTICS) !== 0;
  let createOptions = FILE_SYNCHRONOUS_IO_NONALERT | (backup ? FILE_OPEN_FOR_BACKUP_INTENT : FILE_NON_DIRECTORY_FILE);
  if ((options.flags & FILE_FLAG_OPEN_REPARSE_POINT) !== 0) createOptions |= FILE_OPEN_REPARSE_POINT;
  if ((options.flags & FILE_FLAG_WRITE_THROUGH) !== 0) createOptions |= FILE_WRITE_THROUGH;
  return {
    access: (options.access | SYNCHRONIZE | FILE_READ_ATTRIBUTES) >>> 0,
    attributes: FILE_ATTRIBUTE_NORMAL,
    share: options.share,
    disposition,
    createOptions: createOptions >>> 0,
  };
}

/** The NT object path of an absolute Win32 path, as CreateFileW resolves it: `C:\x` -> `\??\C:\x`, UNC -> `\??\UNC\...`. */
export function ntPath(path: string): string {
  const win = path.replaceAll("/", "\\");
  if (win.startsWith("\\\\?\\")) return `\\??\\${win.slice(4)}`;
  if (win.startsWith("\\\\")) return `\\??\\UNC\\${win.slice(2)}`;
  if (/^[A-Za-z]:\\/.test(win)) return `\\??\\${win}`;
  throw new RangeError(`private state paths are absolute: ${path}`);
}

const failed = (status: number): boolean => (status | 0) < 0;

/** The Win32 code CreateFileW reports for `status`: its own mapping, except a name collision, which it reports as 80. */
export function win32CodeOf(status: number, toDos: (status: number) => number): number {
  return status === STATUS_OBJECT_NAME_COLLISION ? ERROR_FILE_EXISTS : toDos(status);
}

/**
 * Runs `attempt` (one NtCreateFile) until it succeeds. A file another process holds open without sharing (an
 * antivirus or indexer scan, another writer's handle closing) is waited for, up to `waitMs`; any other status, or one
 * that outlasts the wait, throws a Win32Error carrying the true code.
 */
export function openRetrying<T>(
  attempt: () => { readonly status: number; readonly handle: T },
  toDos: (status: number) => number,
  sleep: (ms: number) => void,
  waitMs = CONTENTION_WAIT_MS,
): T {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { status, handle } = attempt();
    if (!failed(status)) return handle;
    const contended = status === STATUS_SHARING_VIOLATION || status === STATUS_FILE_LOCK_CONFLICT;
    if (!contended || Date.now() >= deadline) throw new Win32Error("NtCreateFile", win32CodeOf(status, toDos));
    sleep(CONTENTION_POLL_MS);
  }
}
