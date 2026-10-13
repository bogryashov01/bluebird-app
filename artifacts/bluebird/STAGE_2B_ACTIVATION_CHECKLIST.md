# Stage 2B Authentication Activation Checklist

Production authentication remains inactive. Do not mount a Clerk provider,
replace the current `AuthContext`, or make authenticated production requests
until every prerequisite below is verified and activation is separately
approved.

## Current compatibility finding

Bluebird is now on Expo SDK 57 and has an isolated, dormant Clerk entry point,
SecureStore token cache, and production-token adapter. `ClerkProvider` remains
unmounted, the existing demo `AuthContext` and routes remain active, and
production authentication remains unavailable. The bridge tests use mocked
Clerk sessions and a mocked API fetcher only. Expo web/iOS/Android Metro exports
are not native runtime or authentication verification. See the
[readiness report](./AUTHENTICATED-API-READINESS.md) for exact check results,
open requirements, and files changed.

- [ ] Confirm a Clerk instance exists for the intended environment and its
      account, application, and allowed origins are correct.
- [ ] Configure the matching `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for that
      environment; do not commit environment values.
- [ ] Verify the actual native config-plugin output and supported Clerk
      SecureStore token-cache persistence in development builds.
- [ ] Confirm with Nick any intended token template, audience/scopes, account
      mapping, identity requirements, or other acceptance criteria; none were
      supplied with the dormant-bridge task.
- [ ] Verify native sign-in, sign-out, token refresh, and session restoration
      on supported iOS and Android runtimes.
- [ ] Configure and test the app's exact deep-link scheme for sign-in return
      and sign-out navigation on both platforms.
- [ ] Confirm the production `GET /api/me` route exists and returns the
      documented authentication fields; test authenticated, signed-out, and
      expired-session responses without weakening production URL validation.
- [ ] Confirm the production backend verifies session tokens from this same
      Clerk instance; the checked-in API server currently validates its own
      `JWT_SECRET`/`SESSION_SECRET`-signed tokens.
- [ ] Review account switching, cached member data clearing, and offline
      failure behavior before connecting the provider to app state.
- [ ] Separately approve mounting `DormantClerkProvider`, connecting the token
      provider to a production API client, and changing any screens or auth
      state. This bridge alone does not enable authenticated requests.
- [ ] Only after all checks pass, plan a separate activation change that
      explicitly mounts the provider and integrates authentication.

This checklist does not activate any production auth flow. Do not treat
JavaScript bundle exports, mocked tests, or the presence of the key as proof of
native session or server compatibility.
