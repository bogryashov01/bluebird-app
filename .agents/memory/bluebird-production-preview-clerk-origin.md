---
name: Production Preview Clerk origin
description: Distinguish Mobile Production auth configuration readiness from Clerk's browser-origin allowlist.
---

**Rule:** Treat a successful Production preflight and matching API/Clerk configuration as syntax/configuration readiness only. A live Clerk key can still reject the managed Replit Preview origin. Keep Production origin checks read-only; if the owner has not verified/approved a web origin, mark the web test blocked and do not request a new host, alter domains/DNS/credentials, or deploy a web test. For the current Bluebird issue, prioritize native iOS diagnosis using the existing TestFlight build and device logs; do not create another build without evidence of a source defect.

**Why:** The managed Bluebird Preview received HTTP 400: Production keys were restricted to `bluebirdjets.com`, and Clerk rejected the Replit Preview origin. On 2026-10-27 the authorized owner said the current Production origin list was not verified, Replit Preview was not confirmed, and no new host/path was approved; the primary issue is a native Build 8 initialization timeout.

**How to apply:** For Production Preview auth failures, preserve the existing sanitized error as historical evidence and mark a new browser test blocked until an already-approved origin is explicitly in scope. Never infer current allowed-origin rules from a key host or assume an extra-origin option exists. For Build 8, prefer its existing IPA and on-device Apple Console evidence; do not add generic diagnostics or rebuild before a concrete cause is isolated.
