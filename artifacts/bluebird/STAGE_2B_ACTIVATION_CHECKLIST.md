# Stage 2B Authentication Activation Checklist

Production authentication remains inactive. Do not mount a Clerk provider,
replace the current `AuthContext`, or make authenticated production requests
until every prerequisite below is verified and activation is separately
approved.

## Current compatibility finding

The current Expo 54.0.37 / React 19.1.0 / React Native 0.81.5 baseline remains
**incompatible with the stable Clerk dependency graph** because Clerk's
transitive React peers exclude 19.1.0. A separate SDK 56.0.23 candidate aligns
the peers with React/React DOM 19.2.3, but it is **not approved for migration or
authentication activation**: Bluebird's typecheck still reports eight errors
across its native-tabs layout and five screens, and Expo documents a Hermes
memory regression affecting Bluebird's Reanimated/Worklets packages. The SDK 56
candidate passed startup and product regression checks, including the earlier
null-`useState` investigation; however, no native development build, SecureStore
restore, or hosted-auth redirect was verified. Expo recommends considering SDK
57 for the memory regression. No app source, dependency, or lockfile changes
were applied to the main workspace. Do not silence peer warnings with
overrides. See
[the readiness report](./AUTHENTICATED-API-READINESS.md) for versions and
verification details.

- [ ] Confirm a Clerk instance exists for the intended environment and its
      account, application, and allowed origins are correct.
- [ ] Configure the matching `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for that
      environment; do not commit environment values.
- [ ] Choose and validate an `@clerk/expo` graph against a separately approved
      Expo baseline without peer overrides, forced installs, or package-policy
      bypasses; the SDK 56 candidate is not yet approved.
- [ ] Resolve the SDK 56 TypeScript and native-tabs/style type errors, assess
      the documented Reanimated/Worklets memory regression, and verify native
      development builds before considering the SDK migration ready.
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
