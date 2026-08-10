---
name: Seat capacity model
description: flights.seatsAvailable is a capacity baseline, never mutated; remaining seats are always derived.
---

**Rule:** `flights.seats_available` is the capacity BASELINE. Never mutate it to reflect bookings. Remaining seats = baseline − sum(passengers of `confirmed` queue entries). Browse endpoints (GET /flights, /flights/:id) present the derived value; join/confirm checks compute it internally. The demo queue simulation books/frees seats only by flipping sim queue entries between `confirmed`/`cancelled`.

**Why:** An earlier simulation decremented seatsAvailable on sim confirms while capacity checks also subtracted confirmed passengers — double-counting that wrongly denied real seats (caught in code review).

**How to apply:** Any new booking/cancellation feature must go through queue-entry status changes, never `UPDATE flights SET seats_available`.
