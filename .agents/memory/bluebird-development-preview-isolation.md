---
name: Bluebird development preview isolation
description: Architectural boundary for local Bluebird screen previews.
---

**Rule:** Select local Preview branches before active auth, Clerk, session restoration, and member-data observers mount. A development demo also needs an explicit opt-in plus a `__DEV__` runtime guard, with a route allowlist; public env flags and direct URLs alone must never enable it.

**Why:** Expo Router can retain the outgoing route during root-stack transitions, and public Expo variables can exist in release bundles. Removing a provider during transitions can break retained auth layouts; an identity-free provider and runtime gate prevent both crashes and release-mode auth bypasses.

**How to apply:** Keep fixture routes and navigation in a separate root branch, allow only intended local screens, and use a context with null identity/token and inert auth methods. Do not mount production readers or mutations. When Preview begins from a Clerk screen, replace it so it is not retained after Clerk unmounts. Verify direct loads and entry/back transitions separately.
