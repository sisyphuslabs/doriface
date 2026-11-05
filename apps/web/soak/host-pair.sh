#!/usr/bin/env bash
# The soak host's side of pairing one client: waits for the client's public key, opens one pairing offer and uploads
# nothing itself; it writes the link sealed to that key to $RUNNER_TEMP/soak-link-<client>.json for the workflow to
# upload. The link and the typed code stay in this shell; neither reaches the log.
#
#   bash apps/web/soak/host-pair.sh <client>
set -euo pipefail
client=$1
bun apps/web/soak/artifact.ts "soak-pubkey-$client" "$RUNNER_TEMP/pubkey-$client" 2400
offer=$(bun apps/host/src/cli.ts pair --no-qr --web-origin "$WEB_ORIGIN" --relay "$RELAY_URL" --state-dir "$HOST_STATE")
link=$(printf '%s\n' "$offer" | grep "^$WEB_ORIGIN/pair#")
printf '%s' "$link" > "$RUNNER_TEMP/link-$client.txt"
bun apps/web/soak/seal.ts seal "$(cat "$RUNNER_TEMP/pubkey-$client/pubkey.txt")" "$RUNNER_TEMP/link-$client.txt" \
  > "$RUNNER_TEMP/soak-link-$client.json"
rm "$RUNNER_TEMP/link-$client.txt"
echo "sealed a pairing link for the $client client"
