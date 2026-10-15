---
name: Production authenticated-data availability
description: Keep local demo identity and cached account data out of production authenticated screens.
---

Production authentication availability is a separate boundary from a signed-in `AuthContext`. Blocking a route's screen-level query is not enough: shared tabs, badges, and layout hooks can still poll member endpoints or expose cached demo values.

**Why:** A production-mode profile regression test still observed notification requests from the tab-layout badge after the profile's own query was disabled.

**How to apply:** Gate shared member-data hooks with the same production-auth availability condition as their screens, and return a neutral value when unavailable. Never use local/demo credentials or cached member responses for production API calls.

Clerk resolution is not route authorization. A future authoritative registered-account result may open Home regardless of membership or member ID; it must not grant booking, queue, trip, or other member-only capabilities, which remain backend-authorized. Keep registration/onboarding readiness separate, and never infer registration from a `/api/me` projection.

**Why:** The existing `/api/me` projection has no authoritative registered-versus-new outcome or stable feature-eligibility result. Membership and profile completeness do not identify registration state.

**How to apply:** Before connecting a new Clerk account decision to navigation, require an explicit registered-versus-new result. Gate Home on registered status only; keep member-only requests and writes under Main API authorization, and do not route new users through legacy-JWT-dependent screens or single-airport writes when the journey uses multi-airport selection.
