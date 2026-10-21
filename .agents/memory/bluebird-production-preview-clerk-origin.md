---
name: Production Preview Clerk origin
description: Distinguish Mobile Production auth configuration readiness from Clerk's browser-origin allowlist.
---

**Rule:** Treat a successful Production preflight and matching API/Clerk configuration as syntax/configuration readiness only. A live Clerk key can still reject the managed Replit Preview origin and leave the app on a loading screen; do not weaken Production validation or treat the error as a stale bundle without checking the served runtime.

**Why:** The managed Bluebird Preview received a Clerk HTTP 400 because its browser origin was not allowed by the Production Clerk instance, even though the Expo process and served bundle both had the approved Production flag and valid matching values.

**How to apply:** For Production Preview auth failures, inspect the actual served bundle and browser network evidence. Separate the app's configuration-error predicate from Clerk's origin rejection, and coordinate an approved domain strategy outside Mobile code when the latter is confirmed.
