---
name: Production authenticated-data availability
description: Keep local demo identity and cached account data out of production authenticated screens.
---

Production authentication availability is a separate boundary from a signed-in `AuthContext`. Blocking a route's screen-level query is not enough: shared tabs, badges, and layout hooks can still poll member endpoints or expose cached demo values.

**Why:** A production-mode profile regression test still observed notification requests from the tab-layout badge after the profile's own query was disabled.

**How to apply:** Gate shared member-data hooks with the same production-auth availability condition as their screens, and return a neutral value when unavailable. Never use local/demo credentials or cached member responses for production API calls.

For post-Clerk navigation, the existing `/api/me` projection is sufficient only when `isAuthenticated === true`: `isProfileComplete === true` opens Flights/Home even without membership, while `false` opens the API-backed profile screen. This does not establish registration status, a stable Bluebird member ID, or member capabilities. Unknown, unauthenticated, malformed, and failed responses stay on the safe status screen.

**Why:** The mobile sign-in journey explicitly uses the existing authentication/profile booleans for profile routing without adding a registration field. The same projection still has no authoritative registered-versus-new result or stable feature-eligibility result.

**How to apply:** Bind every route-authorizing profile result to the current Clerk identity. Keep booking, queues, trips, and other member-only requests and writes under Main API authorization, and do not route through legacy-JWT-dependent registration/onboarding screens or single-airport writes when the journey uses multi-airport selection.
