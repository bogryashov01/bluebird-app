---
name: Occupant capacity
description: Passenger and pet counts share one six-occupant ceiling across queue and manifest flows.
---

The six-person rule counts human passengers plus the existing single-pet flag as occupants; a pet booking therefore allows at most five human passengers. Reserved passenger capacity remains the other bound.

**Why:** A passenger-only maximum permits an invalid six-human-plus-pet booking unless the conditional pet count is enforced separately on both queue creation and manifest saves.

**How to apply:** Keep the six-occupant rule authoritative on the server and mirror its pet-inclusive guidance in every mobile passenger selector, queue continuation path, and manifest editor.