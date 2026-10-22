---
name: Bluebird demo flight sources
description: Source-aware rules for live and fixture flights in the identity-free Bluebird Preview.
---

Keep fixture flights visually useful in the shared screens, but never treat them as public or queue-eligible flights. Only a live Production flight may be used for a public queue read or a local simulated queue entry.

**Why:** A fixture-backed action could look like real public queue participation even though the flight is invented and the demo has no authenticated member.

**How to apply:** Preserve the flight source through list/detail mapping and require `source === 'production'` at every public-queue or demo-queue boundary.
