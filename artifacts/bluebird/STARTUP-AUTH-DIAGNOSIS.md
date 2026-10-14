# Bluebird Preview startup authentication diagnosis

The Bluebird web Preview is served by Expo at its `*.expo.worf.replit.dev` origin, while the configured API/development domain is `*.worf.replit.dev`. Browser storage is scoped to the exact origin. Clearing `bluebird_token` and `bluebird_user` on the non-Expo origin does not clear the Preview's storage. In a fresh browser context on the actual Expo Preview origin, neither Bluebird session key was present and `/` resolved to the signed-out splash; `/discover` also resolved to the splash.

The routing defect was a startup race on direct protected-tab links: the `(tabs)` layout waited to redirect until auth restoration finished, but rendered its tab screens during that wait. A direct `/discover` request could therefore mount Flights and start its flight request before the no-session redirect. The root route already waits for auth restoration. The tab layout now shows a loading state until restoration finishes, and mounts Flights only after a token is restored.

The current Development Preview uses the live Expo web bundle, not the static `static-build` output: its workflow log shows Metro bundling and the active browser loads that host successfully. No stale or disconnected bundle was evidenced. The initial screenshot was blank during startup, but a fresh isolated browser check after the bundle settled showed the splash on `/` and on direct `/discover`.

`EXPO_PUBLIC_ENABLE_CLERK_AUTH=true` is configured in the Development user environment and the actual Preview Welcome screen showed both Clerk links. Clerk-disabled browser coverage explicitly builds with the flag off and no key; enabled coverage uses a test publishable key. Neither case clicks an auth action, sends SMS, or creates a session.
