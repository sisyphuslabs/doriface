// electron-builder's afterSign hook: notarizes the signed macOS app and staples the ticket to it before the dmg and the
// zip are built from it, so both carry a stapled app. It runs only when DORIFACE_NOTARIZE=1, which the release workflow
// sets together with the App Store Connect API key; a local build is left as electron-builder signed it.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../../.github/scripts/macos-notarize.sh", import.meta.url));

/** @param {import("app-builder-lib").AfterPackContext} context */
export default async function notarizeMac(context) {
  if (context.electronPlatformName !== "darwin" || process.env["DORIFACE_NOTARIZE"] !== "1") return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const result = spawnSync("bash", [SCRIPT, app], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`notarizing ${app} failed (${result.status ?? result.signal})`);
}
