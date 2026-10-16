---
name: Flight detail read contract
description: Safe source and cache behavior for public flight details in Bluebird Mobile.
---

Rule: Resolve public flight details by stable ID from the same environment-selected flight-list response and cache used by Discover. Do not assume a per-flight endpoint exists unless the selected Main API documents it.

**Why:** A guessed detail URL can send a Clerk session to the legacy Mobile API or rely on an unsupported Main API route, even though Discover already has the selected flight data.

**How to apply:** Keep Discover and Details on one auth-aware local-versus-Main-API decision and one list query key. For a direct link without cached data, use the documented list read; if its response lacks the ID, show unavailable rather than inventing fields.
