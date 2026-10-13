# Stage 2B Authentication Activation Checklist

Production authentication remains inactive. Do not mount a Clerk provider,
replace the current `AuthContext`, or make authenticated production requests
until every prerequisite below is verified and activation is separately
approved.

## Audit finding

Bluebird has an isolated Clerk Expo entry point and a production-token adapter,
but `ClerkProvider` is not mounted. Demo/local `AuthContext`, screens, and
navigation remain unchanged; `PRODUCTION_AUTH_AVAILABILITY` remains
`unavailable`. The SDK's token cache uses Expo SecureStore on native, but
persistence/restoration has not been tested on a device. Bridge and API tests
use injected sessions/fetchers only; they are not production verification.

The supplied API contract is a dated source snapshot, not a production test.
It specifies HTTPS Clerk Bearer sessions, optional-auth `GET /api/me` with
HTTP 200 and `isAuthenticated: false` for anonymous/caught identity failures,
and 401 for protected routes with unresolved identity. It does not establish
exact expired/malformed-token responses or production session TTL. The mobile
client requires a nonblank token for every request, so it cannot use its
`getMe()` method to exercise the contract's no-token anonymous response. A
token-bearing 200 with `isAuthenticated: false` is parsed as signed out; callers
must gate authenticated behavior on that field.

The checked-in `artifacts/api-server` middleware verifies tokens signed with
its own `JWT_SECRET`/`SESSION_SECRET` and checks its local revocation table. It
does not prove acceptance of Clerk-issued tokens or production runtime
behavior. For the full source comparison and evidence, see the
[readiness report](./AUTHENTICATED-API-READINESS.md).

## Gate 1 — Confirm the intended Clerk and token contract

- [ ] Nick/production API owner confirms the exact Clerk instance/environment,
      account/application, allowed origins, and registered iOS/Android app
      identifiers.
- [ ] Configure the matching environment-specific
      `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` through the approved environment
      configuration. Confirm environment/issuer parity without sharing the
      value in chat, code, or logs. This audit did not read the configured key.
- [ ] API owner states whether mobile must send the default session token or a
      named JWT template, and whether `getToken()` needs a template argument.
- [ ] API owner documents exact expected issuer, audience, authorized-party or
      origin restrictions, subject/identity mapping, and any other required
      claims. Confirm the backend maps the Clerk identity to the correct
      Bluebird account.
- [ ] Confirm which deployed service accepts those tokens and that it hosts the
      contract's `/api/me` and member routes at the mobile client's validated
      production base URL. The checked-in API-server middleware is not evidence
      of this acceptance.

## Gate 2 — Resolve route and expiry behavior

- [ ] Confirm the deployed `/api/me` response for no token, valid token with
      unresolved identity, and caught identity lookup failure, including which
      cases return HTTP 200 with `isAuthenticated: false`.
- [ ] Confirm deployed protected-route behavior for missing, malformed,
      expired, revoked, pending, or otherwise unresolved sessions, including
      status and response body. Confirm whether a fresh Clerk token is accepted
      after an expiry response; do not assume every expiry returns JSON 401.
- [ ] Decide how to resolve the client/contract mismatch: the current
      authenticated API client rejects a missing token before fetch, whereas
      contract `GET /api/me` allows anonymous access. If anonymous discovery is
      required, design and test a separate no-token request path. In all cases,
      treat `isAuthenticated: false` as signed out and never infer identity from
      HTTP 200 alone.
- [ ] Verify actual deployed behavior only through an approved, controlled
      test plan. The existing mock tests, contract snapshot, and local server
      source are not production runtime proof.

## Gate 3 — Verify native operation and security

- [ ] Verify the actual Expo config-plugin output, native identifiers, Clerk
      SecureStore token-cache behavior, persistence, and restore in iOS and
      Android development builds. Metro exports alone are insufficient.
- [ ] Test native sign-in return URLs/deep links, fresh token retrieval and
      refresh, sign-out, and session restoration on supported iOS and Android
      runtimes.
- [ ] Review identity/account switching and clear all account-scoped app and
      query data before another member can see the app. Current demo sign-out
      does not call Clerk; the dormant Clerk `clearClerkSession()` is not wired
      into that flow.
- [ ] Keep bearer tokens out of logs and app-managed plaintext storage. Do not
      add a Clerk secret key to mobile, disable production URL validation, or
      send cookies; preserve `credentials: 'omit'` and avoid demo-token fallback.
- [ ] Review client handling of 401: the client maps a received 401 to
      `session_expired` but has no automatic retry, fresh-token retry, or
      Clerk sign-out behavior. Agree on UI/session recovery before activation.

## Gate 4 — Separate activation approval

- [ ] Nick/product owner and API owner approve activation only after Gates 1–3
      are complete and evidence is recorded.
- [ ] In a separate change, explicitly mount `DormantClerkProvider`, connect
      the Clerk adapter to approved production requests, handle signed-out
      `/api/me` semantics, and make any `AuthContext`, screen, or navigation
      changes required by the approved design.
- [ ] Keep `PRODUCTION_AUTH_AVAILABILITY` unavailable until backend acceptance,
      native behavior, error handling, and cache isolation are verified. Review
      every production-authenticated screen and shared member-data hook before
      making member requests available.

This checklist does not activate production authentication. JavaScript bundle
exports, mocked HTTP 200 responses, the presence of a key, and local API-server
source are not proof of native session behavior or production server
compatibility.
