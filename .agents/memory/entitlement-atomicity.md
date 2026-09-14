---
name: Entitlement consumption atomicity
description: Consumable entitlements (passes, credits) must be spent atomically with the benefit they buy.
---

Never consume an entitlement (Skip the Line pass, credit, etc.) in one request and deliver its benefit in a follow-up client call. When the award creates a durable booking, snapshot every booking-scoped input from the waiting record into that booking in the same transaction.

**Why:** if the second call fails (capacity race, network), the user loses the entitlement without the benefit. If conditional details such as pet measurements stay only on the waiting record, downstream trip manifests lose them after award.

**How to apply:** do consumption + benefit (e.g. seat confirmation + trip creation) inside one serializable server transaction, with capacity/eligibility checks *before* the decrement so a failure rolls everything back. Copy all accepted booking details into the created trip on every award path.
