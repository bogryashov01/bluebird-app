---
name: Flight detail read contract
description: Safe source and cache behavior for public flight details in Bluebird Mobile.
---

Rule: Use the selected API environment's existing `GET /api/empty-legs/{id}` reader when supported, and verify the returned ID matches the request. Preserve the auth-aware local read path; use list/cache resolution only when that environment's documented contract requires it.

**Why:** The existing detail route is supported for the selected flight environment. Reusing it provides fresh detail data without sending credentials across environments or trusting a mismatched response.

**How to apply:** Keep local-versus-Main-API selection explicit and auth-aware. Validate flight IDs before requesting and validating the response; if the selected contract cannot resolve the ID, show unavailable rather than fabricating fields.
