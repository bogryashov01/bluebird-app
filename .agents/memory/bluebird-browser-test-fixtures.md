---
name: Bluebird browser test fixtures
description: Shared authenticated-shell queries that must be stubbed in Bluebird Playwright tests.
---

**Rule:** When browser-mocking authenticated Bluebird screens, stub `/api/notifications` and `/api/queue/status` with arrays, in addition to screen-specific endpoints.

**Why:** The tab badge filters notifications and the global queue observer searches queue entries. Unmocked responses can crash shared UI and replace the tested screen with the error fallback.

**How to apply:** Add both array responses to each authenticated Playwright route handler; if a new test still crashes outside its screen, check other globally mounted queries.