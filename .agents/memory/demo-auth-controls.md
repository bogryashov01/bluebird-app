---
name: Demo auth controls
description: Security controls must be real even in demo flows — cosmetic verification gets rejected
---
Rule: even in this demo environment, auth-adjacent flows (email verification, password reset) need real controls end to end: random single-use tokens hashed at rest with expiry and rotation; honest client failure handling (never advance on error); a centralized routing guard in the protected route group's layout (a check only on the root index is deep-linkable around); and server-side enforcement on the operations that must stay locked. Simulate only the *delivery* (log the link / return the token in-band, clearly marked as demo).

**Why:** A flip-the-flag endpoint, a client that advanced on failure, and a gate placed only on the root route were each rejected in review as bypassable.

**How to apply:** When adding any "prove ownership" flow, gate both the protected layout and the relevant server endpoints on the user flag, and cover the bypass paths (relaunch, deep link, wrong/stale token) in an integration test.
