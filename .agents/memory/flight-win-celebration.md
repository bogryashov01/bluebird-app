---
name: Flight win celebration events
description: Keep one-time pass-win feedback separate from saved won-flight state.
---

**Rule:** Drive win celebrations from a transient one-time event that is consumed by the confirmation screen. Never infer an event from a persistent queue status or replayable route parameter.

**Why:** A saved `won` state survives navigation and reload, while a URL parameter can be replayed; either can show a one-time celebration repeatedly.

**How to apply:** Arm the transient event only after a successful pass win, consume it when the confirmation screen opens, and route later views of that won flight to Flight Details.
