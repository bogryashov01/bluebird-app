---
name: Production Preview Clerk origin
description: Distinguish Mobile Production auth configuration readiness from Clerk's browser-origin allowlist.
---

**Rule:** Treat a successful Production preflight and matching API/Clerk configuration as syntax/configuration readiness only. A live Clerk key can still reject the managed Replit Preview origin and leave the app on a loading screen; do not weaken Production validation or treat the error as a stale bundle without checking the served runtime.

**Why:** The managed Bluebird Preview received HTTP 400: Production keys were restricted to `bluebirdjets.com`, and Clerk rejected the Replit Preview origin. A matching API/Clerk pair and enabled workspace flag did not make that browser origin valid.

**How to apply:** For Production Preview auth failures, inspect the served runtime and browser error. Treat a Replit-hosted Preview as blocked when Clerk's Production domain check rejects it; use an owner-confirmed domain-compatible host. Never infer an allowed-origin Dashboard option without authorized read-only inspection.
