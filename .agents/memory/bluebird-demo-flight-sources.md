---
name: Bluebird demo flight sources
description: Source-aware rules for live and fixture flights in the identity-free Bluebird Preview.
---

Only live Production flights may be used for public queue reads. In the development-only full-app Preview, typed fallback fixtures may create local simulated queue entries; those entries never call a queue mutation endpoint.

**Why:** Bluebird's full-app Preview must exercise the approved queue journey when live flight reads are unavailable, while keeping fixture activity visibly simulated and isolated from Production.

**How to apply:** Preserve flight source. Require `source === 'production'` for any public queue read; allow a typed fixture only in the full-app demo's local-storage queue adapter.
