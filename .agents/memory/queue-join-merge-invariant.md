---
name: Queue join merge invariant
description: Runtime invariant for the authenticated queue join transaction after overlapping route changes.
---

`POST /queue/join` must insert a new queue entry inside its serializable transaction before creating any dependent trip or returning the response. It must use the request body's `flightId`; this route has no `req.params.id`.

**Why:** An overlapping queue-route merge left a compiling `select` using `req.params.id` where the insert belonged. Normal joins then returned a generic 500, while static checks did not catch the behavioral regression.

**How to apply:** When resolving or reviewing queue-route changes, run at least one normal join through the integration flow and verify the response is 201 with a created entry before relying on typechecks.