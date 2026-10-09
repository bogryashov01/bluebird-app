---
name: Bluebird browser test fixtures
description: Shared authenticated-shell queries that must be stubbed in Bluebird Playwright tests.
---

**Rule:** When browser-mocking authenticated Bluebird screens, stub `/api/notifications` and `/api/queue/status` with arrays. Home Airports also needs `/api/flights/airports` as an array; keep its production search request live when testing public search.

**Why:** The tab badge filters notifications and the global queue observer searches queue entries. Home Airports renders the local airport-group catalog separately from its public search API. Non-array fixture responses can crash shared UI and replace the tested screen with the error fallback.

**How to apply:** Add the shared array responses plus the catalog response when relevant, then assert public airport-search traffic separately. If a test crashes outside its screen, check other globally mounted queries.