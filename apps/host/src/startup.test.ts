import { DEFAULT_PUSH_PREFS } from "@doriface/protocol";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken } from "./auth.ts";
import { startHost } from "./host.ts";
import { LOOPBACK_OWNER, SubscriptionStore } from "./push/subscriptions.ts";
import { parseStartupErrorLine } from "./startup-error.ts";
import { createHcSession, resolveHcBin } from "./testing/hc-session.ts";

const CLI = join(import.meta.dir, "cli.ts");
/** These tests spawn the CLI; a cold transpiler cache alone can take most of bun's 5 s default. */
setDefaultTimeout(30_000);

/** A port nobody listens on right now: bind it, read it, release it. */
function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
}

/**
 * Starts a host whose LAN port is taken and returns the main port it had bound. Another process can grab the probed
 * main port first; that attempt fails on the main port instead, so it is retried with a fresh port.
 */
async function mainPortWhenLanFails(lanPort: number, stateDir: string, attempts = 5): Promise<number> {
  if (attempts === 0) throw new Error("the main port was taken on every attempt");
  const main = freePort();
  const error: unknown = await startHost({
    listen: { hostname: "127.0.0.1", port: main },
    lanListen: { hostname: "127.0.0.1", port: lanPort },
    token: generateToken(),
    hc: resolveHcBin(),
    stateDir,
    log: () => {},
  }).then(
    async (host) => {
      await host.stop();
      return new Error("startHost succeeded although the LAN port is taken");
    },
    (reason: unknown) => reason,
  );
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(String(main))) return mainPortWhenLanFails(lanPort, stateDir, attempts - 1);
  expect(message).toContain(String(lanPort));
  return main;
}

describe("startHost", () => {
  test("a LAN listener that cannot bind stops the main listener before rejecting", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-start-"));
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const lanPort = taken.port ?? 0;
    try {
      const main = await mainPortWhenLanFails(lanPort, stateDir);
      const again = Bun.serve({ hostname: "127.0.0.1", port: main, fetch: () => new Response() });
      await again.stop(true);
    } finally {
      await taken.stop(true);
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("the control socket", () => {
  test("a host that cannot open it refuses to start instead of serving without revocation", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-noctl-"));
    mkdirSync(join(stateDir, "host.sock"));
    writeFileSync(join(stateDir, "host.sock", "keep"), "");
    try {
      const start = startHost({
        listen: { hostname: "127.0.0.1", port: 0 },
        token: generateToken(),
        hc: resolveHcBin(),
        stateDir,
        log: () => {},
      });
      await expect(start).rejects.toThrow("control socket");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

/** The pids of live `hc connect` children of one hc session, read from full argv. */
const hcConnectPids = (session: string): number[] =>
  Bun.spawnSync(["ps", "-axo", "pid=,args="], { stdout: "pipe" })
    .stdout.toString()
    .split("\n")
    .filter((line) => line.includes(" connect ") && line.includes(session))
    .map((line) => Number.parseInt(line.trim(), 10));

/**
 * Starts a host on its own hc session with a stored push subscription, so the push feed starts its `hc connect` child
 * before the listeners and the control socket; `prepare` makes one of those fail (and may name a LAN listener). The
 * host is started twice: in this process, where a child it leaves stays alive with its parent (the `left` pids, read
 * as soon as the start rejects), and as the CLI, for its exit status and its startup-error line.
 */
async function failedStart(prepare: (stateDir: string) => { readonly lan?: { hostname: string; port: number } }) {
  const session = createHcSession("dh-unwind");
  const stateDir = mkdtempSync(join(tmpdir(), "dh-unwind-"));
  try {
    new SubscriptionStore(stateDir).put(
      LOOPBACK_OWNER,
      { endpoint: "https://fcm.googleapis.com/fcm/send/unwind", p256dh: "B".repeat(87), auth: "C".repeat(22) },
      DEFAULT_PUSH_PREFS,
    );
    const { lan } = prepare(stateDir);
    const rejected: unknown = await startHost({
      listen: { hostname: "127.0.0.1", port: 0 },
      lanListen: lan,
      token: generateToken(),
      hc: session.hc,
      session: session.name,
      env: session.env,
      stateDir,
      log: () => {},
    }).then(
      async (host) => {
        await host.stop();
        return undefined;
      },
      (reason: unknown) => reason,
    );
    const left = hcConnectPids(session.name);
    const args = ["--listen", "127.0.0.1:0", "--hc", session.hc, "--session", session.name, "--state-dir", stateDir];
    const lanArgs = lan === undefined ? [] : ["--lan-listen", `${lan.hostname}:${lan.port}`];
    const proc = Bun.spawn([process.execPath, CLI, ...args, ...lanArgs, "--no-relay"], {
      env: session.env,
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const status = await proc.exited;
    const report = stderr
      .split("\n")
      .map(parseStartupErrorLine)
      .find((line) => line !== undefined);
    return { rejected, left, status, report, leftAfterExit: hcConnectPids(session.name) };
  } finally {
    for (const pid of hcConnectPids(session.name)) process.kill(pid, "SIGTERM");
    await session.dispose();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

describe("a host whose push feed started", () => {
  test("stop settles once the feed's hc connect child has exited", async () => {
    const session = createHcSession("dh-stop");
    const stateDir = mkdtempSync(join(tmpdir(), "dh-stop-"));
    try {
      new SubscriptionStore(stateDir).put(
        LOOPBACK_OWNER,
        { endpoint: "https://fcm.googleapis.com/fcm/send/stop", p256dh: "B".repeat(87), auth: "C".repeat(22) },
        DEFAULT_PUSH_PREFS,
      );
      const host = await startHost({
        listen: { hostname: "127.0.0.1", port: 0 },
        token: generateToken(),
        hc: session.hc,
        session: session.name,
        env: session.env,
        stateDir,
        log: () => {},
      });
      // The feed spawns its child while the host starts; read its pid before stopping, since an exited pid is not listed.
      const pids = hcConnectPids(session.name);
      expect(pids).toHaveLength(1);
      await host.stop();
      const alive = pids.filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      });
      expect(alive).toEqual([]);
    } finally {
      for (const pid of hcConnectPids(session.name)) process.kill(pid, "SIGTERM");
      await session.dispose();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("a startup that fails after the push feed started", () => {
  test("a control socket that cannot bind exits non-zero and leaves no hc connect child", async () => {
    const run = await failedStart((stateDir) => {
      mkdirSync(join(stateDir, "host.sock"));
      writeFileSync(join(stateDir, "host.sock", "keep"), "");
      return {};
    });
    expect(String(run.rejected)).toContain("control socket");
    expect(run.left).toEqual([]);
    expect(run.status).not.toBe(0);
    expect(run.report?.code).toBe("startup-failed");
    expect(run.report?.message).toContain("control socket");
    expect(run.leftAfterExit).toEqual([]);
  });

  test("a LAN listener that cannot bind exits non-zero and leaves no hc connect child", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    try {
      const run = await failedStart(() => ({ lan: { hostname: "127.0.0.1", port: taken.port ?? 0 } }));
      expect(String(run.rejected)).toContain(String(taken.port));
      expect(run.left).toEqual([]);
      expect(run.status).not.toBe(0);
      expect(run.report?.code).toBe("port-in-use");
      expect(run.leftAfterExit).toEqual([]);
    } finally {
      await taken.stop(true);
    }
  });
});

describe("a startup that fails while the push feed's hc connect ignores EOF and TERM", () => {
  test("the unwind kills that child by its pid, so the startup-error exit leaves none behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-hung-"));
    const session = `dh-hung-${crypto.randomUUID().slice(0, 8)}`;
    // An hc whose connect never exits on its own: closing its stdin and SIGTERM both leave it running.
    const hc = join(dir, "hc");
    writeFileSync(
      hc,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "hc 0.1.17"; exit 0; fi\ntrap \'\' TERM HUP\nwhile :; do sleep 1; done\n',
      { mode: 0o755 },
    );
    const stateDir = join(dir, "state");
    mkdirSync(stateDir, { mode: 0o700 });
    new SubscriptionStore(stateDir).put(
      LOOPBACK_OWNER,
      { endpoint: "https://fcm.googleapis.com/fcm/send/hung", p256dh: "B".repeat(87), auth: "C".repeat(22) },
      DEFAULT_PUSH_PREFS,
    );
    mkdirSync(join(stateDir, "host.sock"));
    writeFileSync(join(stateDir, "host.sock", "keep"), "");
    try {
      const args = ["--listen", "127.0.0.1:0", "--hc", hc, "--session", session, "--state-dir", stateDir, "--no-relay"];
      // A file, not a pipe: a child left alive would hold a stderr pipe open, and reading it would never end.
      const errors = join(dir, "stderr.txt");
      const proc = Bun.spawn([process.execPath, CLI, ...args], { stdout: "ignore", stderr: Bun.file(errors) });
      const status = await proc.exited;
      const stderr = await Bun.file(errors).text();
      const report = stderr
        .split("\n")
        .map(parseStartupErrorLine)
        .find((line) => line !== undefined);
      expect(status).toBe(3);
      expect(report?.code).toBe("startup-failed");
      expect(stderr).toContain("killed hc connect pid");
      expect(stderr.toLowerCase()).not.toContain("unhandled");
      expect(hcConnectPids(session)).toEqual([]);
    } finally {
      for (const pid of hcConnectPids(session)) process.kill(pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("a host whose core never answers the write of its OS", () => {
  test("starts within the bound, the write still pending, and stop reaps the write's child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-silent-"));
    // An hc whose connect never answers the hello, keeps its output open, and exits once its input ends, as hc does.
    const hc = join(dir, "hc");
    writeFileSync(
      hc,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "hc 0.1.17"; exit 0; fi\necho $$ > "${dir}/connect.pid"\nwhile read -r line; do :; done\n`,
      { mode: 0o755 },
    );
    try {
      const host = await startHost({
        listen: { hostname: "127.0.0.1", port: 0 },
        token: generateToken(),
        hc,
        platform: "darwin",
        log: () => {},
      });
      // The client's own handshake deadline (10 s) has not passed: only the start's bound let it serve.
      const pid = Number(readFileSync(join(dir, "connect.pid"), "utf8"));
      expect(alive(pid)).toBe(true);
      await host.stop();
      expect(alive(pid)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a LAN listener", () => {
  test("without a state dir is refused rather than silently not served", async () => {
    const start = startHost({
      listen: { hostname: "127.0.0.1", port: 0 },
      lanListen: { hostname: "127.0.0.1", port: 0 },
      token: generateToken(),
      hc: resolveHcBin(),
      log: () => {},
    });
    await expect(start).rejects.toThrow("needs a state dir");
  });
});

describe("a second host", () => {
  test("refuses to start on a state dir a running host serves", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-twice-"));
    const options = {
      listen: { hostname: "127.0.0.1", port: 0 },
      token: generateToken(),
      hc: resolveHcBin(),
      stateDir,
      log: () => {},
    };
    const first = await startHost(options);
    try {
      await expect(startHost(options)).rejects.toThrow("already running");
    } finally {
      await first.stop();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("cli", () => {
  test("devices list escapes control characters in names it did not write", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-cli-"));
    const device = {
      clientStaticPub: "A".repeat(43),
      name: "ok\u001b[2J\nfake line",
      pairedAt: "2026-01-01\u001b[2J\nT00:00",
    };
    writeFileSync(join(stateDir, "devices.json"), JSON.stringify({ version: 1, devices: [device] }));
    const proc = Bun.spawn([process.execPath, CLI, "devices", "list", "--state-dir", stateDir], { stdout: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    rmSync(stateDir, { recursive: true, force: true });
    expect(stdout.split("\n")).toHaveLength(2);
    expect(stdout).toContain("ok\\u001b[2J\\u000afake line");
    expect(stdout).toContain("2026-01-01\\u001b[2J\\u000aT00:00");
  });

  test("a bad --lan-listen is reported as --lan-listen", async () => {
    const proc = Bun.spawn([process.execPath, CLI, "--lan-listen", "nope"], { stderr: "pipe" });
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(2);
    expect(stderr).toContain("--lan-listen wants host:port");
  });

  test("pair with an unusable --web-origin fails before it replaces the pending offer", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "dh-cli-"));
    try {
      const proc = Bun.spawn(
        [process.execPath, CLI, "pair", "--no-qr", "--web-origin", "file:///x", "--state-dir", stateDir],
        { stderr: "pipe" },
      );
      expect(await proc.exited).not.toBe(0);
      expect(existsSync(join(stateDir, "pairing.json"))).toBe(false);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("a malformed devices command fails without touching the state dir", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dh-cli-"));
    const stateDir = join(parent, "never");
    try {
      const proc = Bun.spawn([process.execPath, CLI, "devices", "lsit", "--state-dir", stateDir], { stderr: "pipe" });
      expect(await proc.exited).toBe(2);
      expect(Bun.spawnSync(["test", "-e", stateDir]).exitCode).toBe(1);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
