---
name: Bluebird browser navigation verification
description: How to distinguish local browser interaction coverage from an authenticated hosted Expo Preview check.
---

**Rule:** A direct detail URL or local Playwright run is not proof of live Discover navigation. Verify a tap from a visible card in the hosted Preview; if the browser is stopped at Clerk sign-in, report that limitation and leave authentication unchanged.

**Why:** Hosted Bluebird Expo Preview can require a signed-in Clerk session, while automated local tests intentionally disable Clerk and use intercepted flight APIs. A page that renders a route does not verify the card-to-route event.

**How to apply:** Exercise the whole Discover → card → detail → Back flow in Playwright with the flight read mode expected by the fixture. Treat hosted Preview verification separately and do not bypass its auth gate to manufacture a pass.
