---
name: Bluebird browser navigation verification
description: How to distinguish local browser interaction coverage from an authenticated hosted Expo Preview check.
---

**Rule:** A direct detail URL or local Playwright run is not proof of live Discover navigation. Verify a tap from a visible card in the hosted Preview; if the browser is stopped at Clerk sign-in, report that limitation and leave authentication unchanged.

**Why:** Hosted Bluebird Expo Preview can require a signed-in Clerk session, while automated local tests intentionally disable Clerk and use intercepted flight APIs. A page that renders a route does not verify the card-to-route event.

**How to apply:** Exercise the whole Discover → card → detail → Back flow in Playwright with the flight read mode expected by the fixture. Treat hosted Preview verification separately and do not bypass its auth gate to manufacture a pass.

**Additional rule:** If the hosted Expo Preview remains on its initial Clerk-loading spinner or renders a blank auth route while local Playwright routes pass, report a hosted-preview/auth-runtime blocker rather than calling individual screens broken. Keep auth unchanged until the preview state and configuration are diagnosed.

**Why:** The hosted Expo domain can bundle and start the app without producing visible Welcome or sign-in UI, while the same routes pass in the controlled local browser suite.

**How to apply:** Record the hosted route, viewport, screenshot, and console output; compare with local runs that set their auth mode explicitly. Do not clear the user's session or bypass Clerk to force a screen to render.
