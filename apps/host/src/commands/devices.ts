import { parseArgs } from "node:util";
import { requestControl } from "../control.ts";
import { deviceIdOf, DeviceStore } from "../state/devices.ts";
import { defaultStateDir } from "../state/files.ts";

export const DEVICES_USAGE = `usage: doriface-host devices list [--state-dir <dir>]
       doriface-host devices revoke <id> [--state-dir <dir>]

  revoke removes the device; a running host on the same state dir closes its live sessions (close code 4401)`;

/** `devices list` prints one device per line; `devices revoke <id>` removes one. Returns the exit code. */
export async function devicesCommand(args: readonly string[], out: (text: string) => void): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: true,
    options: { "state-dir": { type: "string" }, help: { type: "boolean", short: "h", default: false } },
  });
  const [action, handle, ...extra] = positionals;
  if (values.help) {
    out(`${DEVICES_USAGE}\n`);
    return 0;
  }
  const store = new DeviceStore(values["state-dir"] ?? defaultStateDir());
  if (action === "list" && handle === undefined) {
    const devices = store.list();
    if (devices.length === 0) out("no paired devices\n");
    for (const device of devices) out(`${deviceIdOf(device)}  ${device.pairedAt}  ${device.name}\n`);
    return 0;
  }
  if (action === "revoke" && handle !== undefined && extra.length === 0) {
    const stateDir = values["state-dir"] ?? defaultStateDir();
    const removed = store.revoke(handle);
    if (removed.length === 0) throw new Error(`no paired device has the id ${JSON.stringify(handle)}`);
    await requestControl(stateDir, { op: "devices-changed" });
    for (const device of removed) out(`revoked ${deviceIdOf(device)}  ${device.name}\n`);
    return 0;
  }
  throw new Error(`unknown devices command: ${positionals.join(" ")}`);
}
