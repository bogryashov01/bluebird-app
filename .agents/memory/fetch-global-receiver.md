---
name: Fetch global receiver
description: Preserve the global receiver when invoking Fetch through a stored request-options callback.
---

**Rule:** Invoke a captured browser Fetch implementation with `globalThis` as its receiver; do not call it as a property of the options object.

**Why:** Calling `options.fetcher(...)` binds `this` to the request-options object. Browser Fetch rejects that receiver with a `TypeError`, which can be misreported as an ambiguous transport failure.

**How to apply:** In shared transports that store `fetch` on an options object, call it with `.call(globalThis, url, init)` and add a regression test that checks the receiver.
