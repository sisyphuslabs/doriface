#!/usr/bin/env bash
# Notarizes a Developer ID signed .app or .dmg with an App Store Connect API key, then staples the ticket to it.
#
# Usage: macos-notarize.sh <path to .app or .dmg>
# Env:   APPLE_API_KEY (path to the AuthKey .p8 file), APPLE_API_KEY_ID, APPLE_API_ISSUER,
#        NOTARIZE_TIMEOUT_SECONDS (optional, default 2700).
#
# It submits without `notarytool --wait` and polls `notarytool info` itself, so a network error while Apple is still
# working retries instead of failing a build whose submission is fine.
set -euo pipefail

target="${1:?usage: macos-notarize.sh <path to .app or .dmg>}"
fail() {
  echo "::error title=Notarization::$1"
  exit 1
}

for name in APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
  [ -n "${!name:-}" ] || fail "$name is not set"
done
[ -f "$APPLE_API_KEY" ] || fail "APPLE_API_KEY must be the path to the .p8 key file"
[ -e "$target" ] || fail "$target does not exist"

notary=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
name=$(basename "$target")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

case "$target" in
  *.app)
    # notarytool takes an app as a zip; the ticket is stapled to the app itself afterwards.
    upload="$work/${name%.app}.zip"
    ditto -c -k --keepParent "$target" "$upload"
    ;;
  *.dmg) upload="$target" ;;
  *) fail "expected a .app or a .dmg, got $target" ;;
esac

submitted=$(xcrun notarytool submit "$upload" "${notary[@]}" --output-format json)
id=$(jq -r '.id // empty' <<<"$submitted")
[ -n "$id" ] || fail "notarytool returned no submission id for $name: $submitted"
echo "Submitted $name for notarization as $id"

deadline=$(($(date +%s) + ${NOTARIZE_TIMEOUT_SECONDS:-2700}))
while :; do
  status=""
  if info=$(xcrun notarytool info "$id" "${notary[@]}" --output-format json 2>&1); then
    status=$(jq -r '.status // empty' <<<"$info")
  else
    echo "notarytool info failed, retrying: $info"
  fi
  case "$status" in
    Accepted) break ;;
    Invalid | Rejected)
      xcrun notarytool log "$id" "${notary[@]}" || true
      fail "Apple answered $status for $name ($id)"
      ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || fail "$name ($id) was still ${status:-unknown} at the deadline"
  echo "$name: ${status:-unknown}"
  # Apple has no callback for a submission, so this waits between polls.
  sleep 20
done
echo "Notarization accepted for $name"

# The ticket of a just-accepted submission can take a while to reach Apple's ticket service, and stapler then fails
# with error 68 or a dropped connection; retry it rather than fail an accepted build.
for attempt in $(seq 1 12); do
  if xcrun stapler staple "$target"; then
    xcrun stapler validate "$target"
    exit 0
  fi
  echo "stapling $name failed (attempt $attempt of 12), retrying in 30s"
  sleep 30
done
fail "could not staple the notarization ticket to $name ($id)"
