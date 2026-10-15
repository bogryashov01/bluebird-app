---
name: Bluebird Development auth status
description: User-reported status of real Clerk Development sign-in during API connection diagnosis.
---

As of 2026-10-15, the user reported that real Development Clerk authentication, an active session, and access-token acquisition succeed; the reported failure occurs after token acquisition in the browser request.

**Why:** Repeating Clerk setup work would not address a failure observed after token acquisition.

**How to apply:** Reconfirm this observation when debugging, but first inspect the later Preview/API transport boundary rather than assuming the Clerk issuer or sign-in is broken.
