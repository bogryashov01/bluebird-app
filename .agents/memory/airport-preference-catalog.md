---
name: Airport preference catalog
description: Keeps legacy airport migration behavior aligned with the canonical selectable airport catalog.
---

Only migrate legacy single-airport preferences when the code belongs to the same canonical catalog accepted by the account API. Make the conversion one-way by detecting the new column's first introduction and retiring the legacy value after it is considered.

**Why:** A syntactically valid but unknown legacy code would otherwise be returned as a saved preference that the current API refuses to save again. Re-running a cardinality-based backfill would also restore an old value after a member intentionally clears all preferences.

**How to apply:** Whenever selectable airport codes change, update runtime validation and the one-time backfill allowlist. Test an unknown three-letter code plus clear-all followed by another schema bootstrap.