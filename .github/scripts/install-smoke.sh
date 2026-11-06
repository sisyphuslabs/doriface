#!/usr/bin/env bash
# The host installer on a clean runner (#668): from a release directory holding this commit's compiled doriface-host
# and its SHA256SUMS.txt, apps/host/install/install.sh must end with herdr-core installed, the host running as a user
# service with a relay slot, and a printed QR code; a second run upgrades in place and --uninstall removes it.
# Usage: install-smoke.sh <os-arch> (linux-x64 or mac-arm64), from the repository root after `bun install`.
set -euo pipefail

target="$1"
case "$target" in
  linux-*) os=linux ;;
  mac-*) os=mac ;;
  *) echo "::error::unknown target $target" && exit 2 ;;
esac

if command -v hc >/dev/null 2>&1 || [ -e "$HOME/.local/bin/hc" ]; then
  echo "::error::this runner already has hc, so it cannot show the installer installing it"
  exit 1
fi

bun run --cwd apps/desktop build:host "$target"
release="$RUNNER_TEMP/release"
mkdir -p "$release"
cp "apps/desktop/dist/host/$target/doriface-host" "$release/doriface-host-$target"
(cd "$release" && shasum -a 256 "doriface-host-$target" > SHA256SUMS.txt && cat SHA256SUMS.txt)

service_running() {
  if [ "$os" = linux ]; then
    [ "$(systemctl --user is-active doriface-host.service)" = active ]
  else
    launchctl print "gui/$(id -u)/dev.omo.doriface-host" | grep -q 'state = running'
  fi
}

out="$RUNNER_TEMP/install.out"
sh apps/host/install/install.sh --from "file://$release" 2>&1 | tee "$out"

"$HOME/.local/bin/hc" --version
service_running || { echo "::error::the host service is not running after the install"; exit 1; }
grep -q '^doriface://pair#' "$out" || { echo "::error::the install printed no pairing link"; exit 1; }
grep -q '▀\|▄\|█' "$out" || { echo "::error::the install printed no QR code"; exit 1; }
grep -q '^code        ' "$out" || { echo "::error::the install printed no pairing code"; exit 1; }
if grep -q 'not registered with the relay\|no relay slot' "$out"; then
  echo "::error::the running host opened the offer without a relay slot"
  exit 1
fi

sh apps/host/install/install.sh --from "file://$release" --no-pair
service_running || { echo "::error::the host service is not running after an upgrade"; exit 1; }

sh apps/host/install/install.sh --uninstall
if service_running; then
  echo "::error::the host service still runs after --uninstall"
  exit 1
fi
[ ! -e "$HOME/.local/bin/doriface-host" ] || { echo "::error::--uninstall left the binary"; exit 1; }
echo "install smoke passed on $target"
