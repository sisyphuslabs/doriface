import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "..", ".github", "scripts", "merge-update-feed.ts");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Asset = { name: string; body: string };

function sha512(body: string): string {
  return new Bun.CryptoHasher("sha512").update(body).digest("base64");
}

function feedYaml(version: string, assets: readonly Asset[]): string {
  const files = assets.map((a) => `  - url: ${a.name}\n    sha512: ${sha512(a.body)}\n    size: ${a.body.length}`);
  const [first] = assets;
  return `version: ${version}\nfiles:\n${files.join("\n")}\npath: ${first?.name}\nsha512: ${sha512(first?.body ?? "")}\nreleaseDate: '2026-11-06T00:00:00.000Z'\n`;
}

/** An assets directory as the release job sees it: the downloads plus one feed-<os>-<arch> directory per runner. */
function assetsDir(feeds: Record<string, Record<string, string>>, assets: readonly Asset[]): string {
  const dir = mkdtempSync(join(tmpdir(), "merge-update-feed-"));
  dirs.push(dir);
  for (const asset of assets) writeFileSync(join(dir, asset.name), asset.body);
  for (const [runner, files] of Object.entries(feeds)) {
    mkdirSync(join(dir, runner));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, runner, name), body);
  }
  return dir;
}

async function run(dir: string): Promise<{ code: number; err: string }> {
  const proc = Bun.spawn([process.execPath, SCRIPT, dir], { stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, err };
}

const armZip = { name: "Doriterm-1.2.0-arm64-mac.zip", body: "arm zip" };
const x64Zip = { name: "Doriterm-1.2.0-x64-mac.zip", body: "x64 zip bytes" };
const armExe = { name: "Doriterm-1.2.0-arm64-setup.exe", body: "arm exe" };
const x64Exe = { name: "Doriterm-1.2.0-x64-setup.exe", body: "x64 exe bytes" };
const appImage = { name: "Doriterm-1.2.0-x86_64.AppImage", body: "appimage" };

test("each feed name becomes one file listing every runner's downloads, and the runner directories go", async () => {
  const dir = assetsDir(
    {
      "feed-mac-arm64": { "latest-mac.yml": feedYaml("1.2.0", [armZip]) },
      "feed-mac-x64": { "latest-mac.yml": feedYaml("1.2.0", [x64Zip]) },
      "feed-win-arm64": { "latest.yml": feedYaml("1.2.0", [armExe]) },
      "feed-win-x64": { "latest.yml": feedYaml("1.2.0", [x64Exe]) },
      "feed-linux-x64": { "latest-linux.yml": feedYaml("1.2.0", [appImage]) },
    },
    [armZip, x64Zip, armExe, x64Exe, appImage],
  );

  const { code, err } = await run(dir);

  expect(err).toBe("");
  expect(code).toBe(0);
  expect(readdirSync(dir).filter((name) => name.startsWith("feed-"))).toEqual([]);
  const mac = Bun.YAML.parse(await Bun.file(join(dir, "latest-mac.yml")).text()) as {
    version: string;
    files: { url: string; sha512: string; size: number }[];
  };
  expect(mac.version).toBe("1.2.0");
  expect(mac.files).toEqual([
    { url: armZip.name, sha512: sha512(armZip.body), size: armZip.body.length },
    { url: x64Zip.name, sha512: sha512(x64Zip.body), size: x64Zip.body.length },
  ]);
  const win = Bun.YAML.parse(await Bun.file(join(dir, "latest.yml")).text()) as { files: { url: string }[] };
  expect(win.files.map((file) => file.url)).toEqual([armExe.name, x64Exe.name]);
  expect(existsSync(join(dir, "latest-linux.yml"))).toBe(true);
});

test("a feed naming a file the release does not carry, or carries with other bytes, stops the release", async () => {
  const missing = assetsDir({ "feed-mac-arm64": { "latest-mac.yml": feedYaml("1.2.0", [armZip]) } }, []);
  expect((await run(missing)).code).toBe(1);

  const changed = assetsDir({ "feed-mac-arm64": { "latest-mac.yml": feedYaml("1.2.0", [armZip]) } }, [
    { name: armZip.name, body: "arm zop" },
  ]);
  const result = await run(changed);
  expect(result.code).toBe(1);
  expect(result.err).toContain("sha512");
});

test("runners that disagree on the version stop the release", async () => {
  const dir = assetsDir(
    {
      "feed-mac-arm64": { "latest-mac.yml": feedYaml("1.2.0", [armZip]) },
      "feed-mac-x64": { "latest-mac.yml": feedYaml("1.2.1", [x64Zip]) },
    },
    [armZip, x64Zip],
  );
  const { code, err } = await run(dir);
  expect(code).toBe(1);
  expect(err).toContain("disagree");
});

test("no runner feed at all stops the release", async () => {
  expect((await run(assetsDir({}, [armZip]))).code).toBe(1);
});
