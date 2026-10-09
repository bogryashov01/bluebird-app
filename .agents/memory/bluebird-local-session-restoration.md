---
name: Bluebird local session restoration
description: Restore valid cached sessions safely without extending demo-only offline behavior to production authentication.
---

**Rule:** In the current local-session flow, validate the stored token/user pair before setting either auth state. Bound the server revalidation request; clear malformed or 401-rejected pairs, and preserve a valid cache only when the check fails due to network, timeout, or server error. Do not carry this fail-open cache policy into production authentication without an explicit security design.

**Why:** A malformed cached user combined with an interrupted auth request could otherwise set the token first and route the app into signed-in screens without a valid user. An unbounded revalidation could also hold startup loading forever.

**How to apply:** Keep startup regression cases for malformed, expired, and temporarily unreachable sessions together, and revisit the offline fallback when the production auth provider is introduced.
