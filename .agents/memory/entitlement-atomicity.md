---
name: Entitlement consumption atomicity
description: Consumable entitlements (passes, credits) must be spent atomically with the benefit they buy.
---

Never consume an entitlement (Skip the Line pass, credit, etc.) in one request and deliver its benefit in a follow-up client call. **Why:** if the second call fails (capacity race, network), the user loses the entitlement without the benefit — reviewers reject this as entitlement loss. **How to apply:** do consumption + benefit (e.g. seat confirmation + trip creation) inside one serializable server transaction, with capacity/eligibility checks *before* the decrement so a failure rolls everything back.
