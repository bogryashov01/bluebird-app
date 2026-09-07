---
name: Account-scoped prototype state
description: Safe persistence rules for local-only demo records and preferences shared on one device.
---

Local-only state that represents a member's records or preferences must use an account-scoped storage key. During an account-key change, do not render or enable controls until the new key has hydrated.

**Why:** Keeping the prior in-memory value while a new AsyncStorage key loads can briefly expose another member's data and can write that stale value into the new account's key.

**How to apply:** Make persistence writes conditional on the currently hydrated key. For sensitive demo lists, remount by member ID or render a loading state until hydration completes. Device-wide preferences such as appearance may remain unscoped.