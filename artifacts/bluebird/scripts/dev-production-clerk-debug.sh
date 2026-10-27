#!/usr/bin/env bash
set -eu

node scripts/production-clerk-debug-preflight.mjs

if [ -n "${REPLIT_EXPO_SESSION_SECRET:-}" ]; then
  pnpm exec create-launch login --session "$REPLIT_EXPO_SESSION_SECRET" || true
fi

if [ "${BLUEBIRD_EXPO_TUNNEL:-false}" = "true" ]; then
  unset EXPO_PACKAGER_PROXY_URL REACT_NATIVE_PACKAGER_HOSTNAME
  set -- --tunnel
else
  export EXPO_PACKAGER_PROXY_URL="https://${REPLIT_EXPO_DEV_DOMAIN:?}"
  export REACT_NATIVE_PACKAGER_HOSTNAME="$REPLIT_EXPO_DEV_DOMAIN"
  set -- --host lan
fi

exec env -u EXPO_PUBLIC_DOMAIN \
  BROWSER=none \
  EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=production \
  EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_DEBUG=true \
  EXPO_PUBLIC_BLUEBIRD_NATIVE_AUTH_TEST=true \
  EXPO_PUBLIC_ENABLE_CLERK_AUTH=false \
  EXPO_PUBLIC_BLUEBIRD_FULL_APP_DEMO=false \
  EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production \
  EXPO_PUBLIC_BLUEBIRD_MEMBERSHIP_DATA_MODE=production \
  EXPO_PUBLIC_REPL_ID="${REPL_ID:-}" \
  pnpm exec expo start --dev-client --web "$@" --port "${PORT:?}"
