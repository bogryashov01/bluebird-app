# Stage 2B Authentication Activation Checklist

Production authentication remains inactive. Do not mount a Clerk provider,
replace the current `AuthContext`, or make authenticated production requests
until every prerequisite below is verified and activation is separately
approved.

- [ ] Confirm a Clerk instance exists for the intended environment and its
      account, application, and allowed origins are correct.
- [ ] Configure the matching `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for that
      environment; do not commit environment values.
- [ ] Resolve an `@clerk/expo` dependency graph compatible with the pinned
      Expo SDK 54 / React 19.1.0 baseline without peer overrides, forced
      installs, or package-policy bypasses.
- [ ] Verify Clerk's supported Expo SecureStore token-cache setup in the
      actual native app configuration.
- [ ] Verify native sign-in, sign-out, token refresh, and session restoration
      on supported iOS and Android runtimes.
- [ ] Configure and test the app's exact deep-link scheme for sign-in return
      and sign-out navigation on both platforms.
- [ ] Confirm the production `GET /api/me` route exists and returns the
      documented authentication fields; test authenticated, signed-out, and
      expired-session responses without weakening production URL validation.
- [ ] Review account switching, cached member data clearing, and offline
      failure behavior before connecting the provider to app state.
- [ ] Only after all checks pass, plan a separate activation change that
      explicitly mounts the provider and integrates authentication.

This checklist does not install Clerk or activate any production auth flow.
