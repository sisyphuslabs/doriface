import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "install.sh");

interface Rig {
  readonly root: string;
  readonly home: string;
  readonly release: string;
  readonly stubs: string;
  readonly log: string;
}

const rigs: string[] = [];
afterEach(() => {
  for (const dir of rigs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const stub = (dir: string, name: string, body: string): void => {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
};

const sha256 = (bytes: string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/**
 * A HOME, a file:// release holding a fake doriface-host and its SHA256SUMS.txt, and stubs for uname and the service
 * managers that append every call to one log, so a test reads what the installer did in order.
 */
function rig(system: "Linux" | "Darwin", machine = "x86_64"): Rig {
  const root = mkdtempSync(join(tmpdir(), "df-install-"));
  rigs.push(root);
  const home = join(root, "home");
  const release = join(root, "release");
  const stubs = join(root, "stubs");
  const log = join(root, "calls.log");
  for (const dir of [home, release, stubs]) mkdirSync(dir, { recursive: true });
  writeFileSync(log, "");
  stub(stubs, "uname", `[ "$1" = -s ] && echo ${system} || echo ${machine}`);
  stub(stubs, "systemctl", `echo "systemctl $*" >> "${log}"`);
  stub(stubs, "launchctl", `echo "launchctl $*" >> "${log}"`);
  const os = system === "Linux" ? "linux" : "mac";
  const arch = machine === "x86_64" ? "x64" : "arm64";
  const host = [
    "#!/bin/sh",
    `echo "doriface-host $*" >> "${log}"`,
    `if [ "$1" = --install-hc ]; then mkdir -p "$HOME/.local/bin"; printf '#!/bin/sh\\necho 0.1.17\\n' > "$HOME/.local/bin/hc"; chmod 755 "$HOME/.local/bin/hc"; fi`,
    `if [ "$1" = pair ]; then echo "doriface://pair#h=fake"; fi`,
    "",
  ].join("\n");
  const asset = `doriface-host-${os}-${arch}`;
  writeFileSync(join(release, asset), host);
  writeFileSync(join(release, "SHA256SUMS.txt"), `${sha256(host)}  ${asset}\n${"0".repeat(64)}  other.zip\n`);
  return { root, home, release, stubs, log };
}

function install(r: Rig, args: readonly string[] = [], extraPath: readonly string[] = []) {
  const proc = Bun.spawnSync(["/bin/sh", SCRIPT, "--from", `file://${r.release}`, ...args], {
    env: {
      HOME: r.home,
      PATH: [r.stubs, ...extraPath, "/usr/bin", "/bin"].join(":"),
      SHELL: "/bin/zsh",
      TMPDIR: r.root,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
    calls: readFileSync(r.log, "utf8").trim().split("\n").filter(Boolean),
  };
}

describe("install.sh on Linux", () => {
  test("installs the checked binary and herdr-core, registers the user service, then waits for it and pairs", () => {
    const r = rig("Linux");
    const run = install(r, ["--web-origin", "https://app.example"]);
    expect(run.err).toBe("");
    expect(run.code).toBe(0);
    const bin = join(r.home, ".local", "bin");
    const hc = join(bin, "hc");
    expect(run.calls).toEqual([
      "systemctl --user show-environment",
      "doriface-host --install-hc",
      "systemctl --user daemon-reload",
      "systemctl --user enable doriface-host.service",
      "systemctl --user restart doriface-host.service",
      "doriface-host pair --wait-host 60 --web-origin https://app.example",
    ]);
    const unit = readFileSync(join(r.home, ".config", "systemd", "user", "doriface-host.service"), "utf8");
    expect(unit).toContain(`ExecStart="${join(bin, "doriface-host")}" --hc "${hc}"`);
    expect(unit).toContain(`Environment="PATH=${bin}:${bin}:${r.stubs}:/usr/bin:/bin" "SHELL=/bin/zsh"`);
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
    expect(run.out).toContain("doriface://pair#h=fake");
  });

  test("keeps an hc already on PATH and runs the service with it", () => {
    const r = rig("Linux", "aarch64");
    const tools = join(r.root, "tools");
    mkdirSync(tools);
    stub(tools, "hc", "echo 0.1.17");
    const run = install(r, ["--no-pair"], [tools]);
    expect(run.code).toBe(0);
    expect(run.calls).not.toContain("doriface-host --install-hc");
    expect(run.calls.some((call) => call.startsWith("doriface-host pair"))).toBe(false);
    const unit = readFileSync(join(r.home, ".config", "systemd", "user", "doriface-host.service"), "utf8");
    expect(unit).toContain(`--hc "${join(tools, "hc")}"`);
    expect(run.out).toContain("using herdr-core at");
  });

  test("a download that does not match SHA256SUMS.txt installs nothing and starts nothing", () => {
    const r = rig("Linux");
    writeFileSync(join(r.release, "doriface-host-linux-x64"), "#!/bin/sh\necho tampered\n");
    const run = install(r);
    expect(run.code).toBe(1);
    expect(run.err).toContain("does not match SHA256SUMS.txt");
    expect(existsSync(join(r.home, ".local", "bin", "doriface-host"))).toBe(false);
    expect(run.calls).toEqual(["systemctl --user show-environment"]);
  });

  test("without a systemd user manager it refuses before downloading, and --no-service installs only", () => {
    const r = rig("Linux");
    stub(r.stubs, "systemctl", `echo "systemctl $*" >> "${r.log}"; exit 1`);
    const refused = install(r);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("--no-service");
    expect(existsSync(join(r.home, ".local", "bin", "doriface-host"))).toBe(false);

    const plain = install(r, ["--no-service"]);
    expect(plain.code).toBe(0);
    expect(existsSync(join(r.home, ".local", "bin", "doriface-host"))).toBe(true);
    expect(plain.out).toContain("start the host with:");
    expect(plain.calls.filter((call) => call.includes("daemon-reload"))).toEqual([]);
  });

  test("--uninstall stops the service and removes it and the binary", () => {
    const r = rig("Linux");
    expect(install(r, ["--no-pair"]).code).toBe(0);
    writeFileSync(r.log, "");
    const run = install(r, ["--uninstall"]);
    expect(run.code).toBe(0);
    expect(run.calls).toContain("systemctl --user disable --now doriface-host.service");
    expect(existsSync(join(r.home, ".config", "systemd", "user", "doriface-host.service"))).toBe(false);
    expect(existsSync(join(r.home, ".local", "bin", "doriface-host"))).toBe(false);
  });
});

describe("install.sh on macOS", () => {
  test("registers a LaunchAgent that keeps the host running, then pairs", () => {
    const r = rig("Darwin", "arm64");
    const run = install(r);
    expect(run.err).toBe("");
    expect(run.code).toBe(0);
    const uid = Bun.spawnSync(["id", "-u"]).stdout.toString().trim();
    expect(run.calls).toEqual([
      "doriface-host --install-hc",
      `launchctl bootout gui/${uid}/dev.omo.doriface-host`,
      `launchctl bootstrap gui/${uid} ${join(r.home, "Library", "LaunchAgents", "dev.omo.doriface-host.plist")}`,
      "doriface-host pair --wait-host 60",
    ]);
    const plist = readFileSync(join(r.home, "Library", "LaunchAgents", "dev.omo.doriface-host.plist"), "utf8");
    expect(plist).toContain(`<string>${join(r.home, ".local", "bin", "doriface-host")}</string>`);
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>SuccessfulExit</key><false/>");
  });
});

describe("install.sh elsewhere", () => {
  test("names the desktop app on Windows-like systems and refuses an unknown CPU", () => {
    expect(install(rig("MINGW64_NT" as "Linux")).err).toContain("install the desktop app");
    expect(install(rig("Linux", "riscv64")).err).toContain("no doriface-host build for CPU riscv64");
  });
});
