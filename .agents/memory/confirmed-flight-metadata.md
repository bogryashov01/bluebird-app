---
name: Confirmed-only flight metadata
description: Privacy boundary for flight-assigned departure details
---
Rule: departure FBO name and address are assigned flight metadata, not public browsing data. Public flight shapes and waiting queue payloads must omit them; confirmed authenticated flight or trip responses may include nullable values.

**Why:** Members should not learn the assigned departure facility before receiving a seat, and queue endpoints can otherwise leak the raw nested flight row even when the detail screen is gated.

**How to apply:** When adding a flight response, check both top-level and nested flight payloads. Use the confirmed status/trip response as the mobile source and preserve null behavior for older records without an assigned FBO.