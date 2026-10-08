#!/bin/bash
set -euo pipefail
CI=true pnpm install --frozen-lockfile
# Workflow reconciliation restarts the API, which runs ensureSchema().
# Do not use drizzle-kit push here: it can prompt to truncate existing data
# and may exit successfully even when its non-interactive prompt fails.
