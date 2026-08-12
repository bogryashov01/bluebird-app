---
name: Departure lifecycle invariant
description: How past-departure flights/trips/queues are kept consistent in the api-server
---
Rule: every queue transition (join, pass use, promotion after a freed seat, simulated advancement) must pass the shared "flight accepts queue actions" guard (available AND departure not passed). The departure sweep (shared helper module) is the single source of truth for date/time comparison and runs lazily on flight/trip reads plus each simulation tick; it completes flights, completes their upcoming trips, and expires waiting queue entries.

**Why:** a completion review rejected a sweep that only flipped flights/trips — waiting entries could still be auto-confirmed or consume a Skip-the-Line pass after departure, creating false confirmations.

**How to apply:** any new code path that confirms a seat, creates a trip, or consumes an entitlement for a flight must reuse the shared guard/helper, never re-derive its own date comparison.
