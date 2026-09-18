---
name: Seat capacity model
description: flights.seatsAvailable is a capacity baseline, never mutated; remaining seats are always derived.
---

**Rule:** `flights.seats_available` is the capacity BASELINE. Never mutate it to reflect bookings. Queue entry stays open until the flight closes; do not use baseline seat demand to reject waiting or Skip-the-Line joins. Enforce party/manifest capacity when a confirmed member saves passenger details, while the demo queue simulation books/frees seats by flipping sim queue entries between `confirmed`/`cancelled`.

**Why:** An earlier simulation decremented seatsAvailable on sim confirms while capacity checks also subtracted confirmed passengers — double-counting that wrongly denied real seats (caught in code review).

**How to apply:** Any new booking/cancellation feature must go through queue-entry status changes, never `UPDATE flights SET seats_available`; keep pre-join checks status-based and keep passenger-list capacity checks in the confirmed manifest flow.
