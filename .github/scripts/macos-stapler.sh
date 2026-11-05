#!/usr/bin/env bash
# Usage: macos-stapler.sh <staple|validate> <path to .app or .dmg>
# Both stapler actions call Apple's ticket service, which from hosted runners drops connections now and then (error 68)
# and can lag a just-accepted notarization; retry a bounded number of times rather than fail a good build.
set -euo pipefail

action="${1:?usage: macos-stapler.sh <staple|validate> <path>}"
target="${2:?usage: macos-stapler.sh <staple|validate> <path>}"
case "$action" in staple | validate) ;; *) echo "::error::unknown stapler action $action" && exit 2 ;; esac

for attempt in $(seq 1 12); do
  if xcrun stapler "$action" "$target"; then
    exit 0
  fi
  echo "stapler $action $(basename "$target") failed (attempt $attempt of 12), retrying in 30s"
  sleep 30
done
echo "::error title=Stapler::stapler $action failed 12 times for $(basename "$target")"
exit 1
