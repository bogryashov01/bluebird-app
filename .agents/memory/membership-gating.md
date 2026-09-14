---
name: Membership gating contract
description: How non-member (tier "none") gating works between api-server and the Bluebird app.
---
Rule: member-only endpoints reject non-members with HTTP 403 and `{ code: "MEMBERSHIP_REQUIRED" }` in the ErrorResponse; the app treats that code (not the message text) as the signal to route to the membership-required paywall screen, forwarding the originating flightId so the purchase flow can return the user.

**Why:** Message-text matching broke silently in earlier flows; a machine-readable code keeps server and client in lockstep, and the server gate must stay authoritative because UI-only hiding can be bypassed via deep links.

**How to apply:** When gating any new member feature, return the same 403 + code from the server AND add a client entry-point guard; never rely on only one side. Non-members also skip demo-data seeding (trips/queues/passes are member features).
