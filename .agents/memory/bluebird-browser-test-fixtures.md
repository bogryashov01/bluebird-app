---
name: Bluebird browser test fixtures
description: Shared query and auth setup required by Bluebird Playwright fixtures.
---

**Rule:** When browser-mocking authenticated Bluebird screens, stub `/api/notifications` and `/api/queue/status` with arrays. Home Airports also needs `/api/flights/airports` as an array; keep its production search request live when testing public search.

**Why:** The tab badge filters notifications and the global queue observer searches queue entries. Home Airports renders the local airport-group catalog separately from its public search API. Non-array fixture responses can crash shared UI and replace the tested screen with the error fallback.

**How to apply:** Add the shared array responses plus the catalog response when relevant, then assert public airport-search traffic separately. If a test crashes outside its screen, check other globally mounted queries.

**Rule:** Local Playwright tests using a synthetic local-shell session must explicitly set `EXPO_PUBLIC_ENABLE_CLERK_AUTH=false`.

**Why:** An inherited Clerk-enabled environment can redirect the fixture to sign-in and fail on unavailable Clerk JS before the tested screen appears.

**How to apply:** Set the flag in the local test command or test-server environment only; never use it to bypass authentication in the hosted Preview.