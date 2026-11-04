import { SettingRow, Switch } from "@doriface/ui";
import { keepAwakeStore, screenWakeLock, useKeepAwake } from "../device/keep-awake.ts";

/** Settings that belong to this browser or device rather than to an account: keeping the screen awake. */
export function DeviceSection() {
  const keepAwake = useKeepAwake();
  const rows = [
    screenWakeLock() === null ? null : (
      <SettingRow
        key="keep-awake"
        inline
        title="Keep the screen awake"
        description="While a terminal is on screen. Released when you switch away."
        control={
          <Switch
            aria-label="Keep the screen awake"
            checked={keepAwake}
            onCheckedChange={(checked) => keepAwakeStore.set(checked)}
          />
        }
      />
    ),
  ].filter((row) => row !== null);
  return rows.length === 0 ? (
    <p className="py-3 text-sm text-muted-foreground">This browser has no device settings.</p>
  ) : (
    <div className="flex flex-col">{rows}</div>
  );
}
