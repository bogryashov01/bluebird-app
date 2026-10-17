---
name: Expo tab auto-routes
description: Route files in Expo Router tab groups can surface in the classic tab bar unless explicitly hidden.
---

**Rule:** Hide non-tab route files inside a classic tab group with `options={{ href: null }}` while preserving navigation through `router.push`.

**Why:** An intended four-tab layout displayed a fifth route-backed screen even though it had no explicit visible tab configuration.

**How to apply:** When a file under a tab group is a drill-down destination, hide it explicitly and test both the visible tab count and direct navigation to that route.
