# Stage 2B Authentication Activation Checklist

Production authentication remains inactive. Do not mount a Clerk provider,
replace the current `AuthContext`, or make authenticated production requests
until every prerequisite below is verified and activation is separately
approved.

## Current compatibility finding

As reviewed on 2026-10-12, the current Expo 54.0.37 / React 19.1.0 /
React Native 0.81.5 baseline is **not ready for a Clerk dependency**. The latest
stable `@clerk/expo@4.10.1` resolves `@clerk/react@6.17.8` and
`@clerk/shared@4.40.0`, whose React peer ranges exclude 19.1.0. The older
`@clerk/expo@2.19.0` graph resolves `@clerk/clerk-js@5.128.0` and
`@clerk/shared@3.48.0`, which also exclude 19.1.0, and its required
`expo-auth-session` peer is absent. No Clerk dependency was installed. Recheck
the complete graph under the unchanged workspace package policy before any
future activation attempt; do not silence these peer warnings with overrides.
See [the readiness report](./AUTHENTICATED-API-READINESS.md) for resolved
versions and details.

- [ ] Confirm a Clerk instance exists for the intended environment and its
      account, application, and allowed origins are correct.
- [ ] Configure the matching `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for that
      environment; do not commit environment values.
- [ ] Resolve an `@clerk/expo` dependency graph compatible with the pinned
      Expo SDK 54 / React 19.1.0 baseline without peer overrides, forced
      installs, or package-policy bypasses.
- [ ] Verify Clerk's supported Expo SecureStore token-cache setup in the
      actual native app configuration.
- [ ] Add a dormant token adapter only in a separately approved activation:
      use Clerk's `useAuth().getToken()` on each request through
      `VerifiedProductionTokenProvider`, return `null` when signed out, never
      persist/log raw tokens, and clear identity-scoped caches on account
      changes. A 401 must invalidate that identity's production data rather
      than fall back to demo auth or stale tokens.
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
- [ ] Only after all checks pass, plan a separate activation change that
      explicitly mounts the provider and integrates authentication.

This checklist does not install Clerk or activate any production auth flow.
