---
name: Production authenticated-data availability
description: Keep local demo identity and cached account data out of production authenticated screens.
---

Production authentication availability is a separate boundary from a signed-in `AuthContext`. Blocking a route's screen-level query is not enough: shared tabs, badges, and layout hooks can still poll member endpoints or expose cached demo values.

**Why:** A production-mode profile regression test still observed notification requests from the tab-layout badge after the profile's own query was disabled.

**How to apply:** Gate shared member-data hooks with the same production-auth availability condition as their screens, and return a neutral value when unavailable. Never use local/demo credentials or cached member responses for production API calls.

Clerk resolution is not route authorization. Keep independent readiness gates for linked-member access and for registration/onboarding routes; the latter remain legacy-JWT-dependent until replaced with Clerk-safe flows. A `/api/me` projection must not change those gates.

**Why:** The existing `/api/me` projection has no authoritative linked, registration-required, or onboarding-required outcome, while the existing account screens still use the legacy Bluebird token.

**How to apply:** Before connecting a new Clerk account decision to navigation, require a documented semantic backend contract and explicit capability for each destination. Keep all capability flags closed until token acceptance, identity mapping, and endpoint behavior are confirmed.
