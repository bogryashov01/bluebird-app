#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# This workflow is deliberately separate from preview:expo-go. It selects the
# real Development pair and cannot enter Full App Demo.
export EXPO_PUBLIC_ENABLE_CLERK_AUTH=true
export EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=development
export EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO=false
export PORT="${PORT:-5000}"

preflight_bundle="${TMPDIR:-/tmp}/bluebird-clerk-development-preflight-$$.mjs"
trap 'rm -f "$preflight_bundle"' EXIT

pnpm --filter @workspace/api-server exec esbuild \
  ../bluebird/scripts/development-clerk-workflow.ts \
  --bundle --platform=node --format=esm \
  --outfile="$preflight_bundle"
BLUEBIRD_CLERK_PREFLIGHT_RUN=true node "$preflight_bundle"

BROWSER=none \
EXPO_PACKAGER_PROXY_URL="https://$REPLIT_EXPO_DEV_DOMAIN" \
EXPO_PUBLIC_DOMAIN="$REPLIT_DEV_DOMAIN" \
EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=local \
EXPO_PUBLIC_REPL_ID="$REPL_ID" \
REACT_NATIVE_PACKAGER_HOSTNAME="$REPLIT_DEV_DOMAIN" \
pnpm exec expo start --web --localhost --port "$PORT"
