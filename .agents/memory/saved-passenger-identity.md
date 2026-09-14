---
name: Saved passenger identity
description: Identity and privacy boundary for reusable passenger records
---
Rule: a reusable passenger is identified only within the authenticated member's library by normalized first and last name. Contact details and weight may be updated by that member; date of birth remains on the trip manifest.

**Why:** The library is meant to reuse stable traveler details without persisting travel-document or flight-specific data, and the same name must not create duplicate member records.

**How to apply:** Scope every list and mutation by the authenticated user, normalize names before duplicate checks, and never move date of birth into the saved passenger record.