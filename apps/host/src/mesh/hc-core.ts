export interface HcCore {
  readonly id: string;
  readonly name: string;
}

export interface HcCoreOptions {
  readonly hc: string;
  readonly session?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

const HELLO = '{"jsonrpc":"2.0","id":0,"method":"hello","params":{}}\n';

function coreOf(line: string): HcCore | undefined {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof message !== "object" || message === null || !("result" in message)) return undefined;
  const result = message.result;
  const core = typeof result === "object" && result !== null && "core" in result ? result.core : undefined;
  if (typeof core !== "object" || core === null || !("id" in core) || !("name" in core)) return undefined;
  return typeof core.id === "string" && typeof core.name === "string" ? { id: core.id, name: core.name } : undefined;
}

/**
 * The herdr core this host serves: its id (a member card's `hcId`) and its name (the default mesh name), read from
 * the reply to a plain `hello` on `hc connect`.
 */
export async function readHcCore(options: HcCoreOptions): Promise<HcCore> {
  const session = options.session === undefined ? [] : ["--session", options.session];
  const proc = Bun.spawn([options.hc, "connect", ...session], {
    env: { ...(options.env ?? process.env) },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(HELLO);
  await proc.stdin.flush();
  let text = "";
  try {
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      text += chunk;
      for (const line of text.split("\n").slice(0, -1)) {
        const core = coreOf(line);
        if (core !== undefined) return core;
      }
    }
  } finally {
    proc.kill();
  }
  throw new Error(`\`${options.hc} connect\` answered no hello with a core`);
}
