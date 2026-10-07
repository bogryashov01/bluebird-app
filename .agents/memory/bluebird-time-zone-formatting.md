---
name: Bluebird time zone formatting
description: Cross-runtime behavior when formatting IANA time zones for airport-local flight times.
---

Use the server-supplied IANA timezone to calculate local departure and arrival times, but do not assume `Intl.DateTimeFormat` will emit a specific short English abbreviation. ICU/runtime combinations can produce `GMT-5` for `America/Chicago` where another runtime produces `CDT`. Keep the raw IANA identifier available and test the local numeric time plus the presence of a formatted zone label, not one abbreviation.

**Why:** The project runs the same flight-time mapping in Node tests and Expo runtimes, whose timezone abbreviation data can differ.

**How to apply:** When formatting airport-local schedules or writing tests for them, treat the IANA timezone as authoritative and keep abbreviation assertions runtime-tolerant.
