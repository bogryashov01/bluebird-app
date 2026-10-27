# Stage 2B Authentication Activation Checklist

Production authentication remains inactive. The mobile app may mount its
isolated Clerk provider only when `EXPO_PUBLIC_ENABLE_CLERK_AUTH` is exactly
`true` and a syntactically valid `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is
present. This gates the prepared UI only. Do not connect Clerk to `AuthContext`
or make authenticated production requests until every prerequisite below is
verified and activation is separately approved.

## Audit finding

Bluebird has an isolated Clerk Expo provider/token adapter plus feature-flagged
phone-code sign-in and sign-up routes and a separate Clerk-only signed-in screen.
The provider is absent unless the exact opt-in flag and a structurally valid
public key are both present. Sign-up requests explicit phone-code verification
and does not activate a session unless Clerk reports a complete sign-up and a
verified phone. Clerk sign-out clears only that Clerk session. Demo/local
`AuthContext`, onboarding, token getter, API client, and
`PRODUCTION_AUTH_AVAILABILITY` remain unchanged (`unavailable`). The SDK token
cache uses Expo SecureStore on native, but persistence/restoration has not been
tested on a device. Lifecycle and bridge tests use mocked Clerk resources only.

The 2026-10-13 preparation recorded a Clerk management status of
`not_configured`. For the 2026-10-14 readiness assessment, supplied
Development-instance settings report phone-number + SMS-code sign-in and
sign-up enabled and verification-at-sign-up disabled. These supplied settings
were not independently checked against Clerk. Environment metadata indicates
an `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` secret is configured, but its value was
not read or checked for validity, instance/issuer match, or presence in an Expo
bundle. The feature-flag value was not read or changed. Neither the supplied
settings nor the configured-key status authorizes enabling the feature.

The disabled sign-up verification setting remains an unresolved
security/product decision for any later member/API integration. The current
phone-only flow fails closed: it explicitly requests verification and blocks
session activation if Clerk refuses that request or returns an unverified
phone. The Clerk Expo 4.10.1 phone-code lifecycle and static peer evidence are
in the [readiness report](./AUTHENTICATED-API-READINESS.md).

The supplied settings are Development-instance settings, not proof of
production methods or backend acceptance. The local API-server middleware
verifies its own-secret `{ userId }` JWTs and does not establish Clerk token
issuer/signature/audience validation or Clerk-to-member identity mapping.
Production API integration remains blocked on an explicit server contract and
owner decision. Do not change production backend/configuration or initiate SMS
flows as part of this mobile assessment.

The supplied API contract is a dated source snapshot, not a production test.
It specifies HTTPS Clerk Bearer sessions, optional-auth `GET /api/me` with
HTTP 200 and `isAuthenticated: false` for anonymous/caught identity failures,
and 401 for protected routes with unresolved identity. It does not establish
exact expired/malformed-token responses or production session TTL. The mobile
client requires a nonblank token for every request, so it cannot use its
`getMe()` method to exercise the contract's no-token anonymous response. A
token-bearing 200 with `isAuthenticated: false` or `isMember: false` remains
pending and does not imply registration or account linking is required. Both
fields true produce only an authenticated-member projection: `/api/me` supplies
no Bluebird member ID, and this does not establish deployed Clerk token
acceptance or identity mapping. The signed-in Pending / Unlinked UI and
unavailable production access gate therefore remain in place.

The checked-in `artifacts/api-server` middleware verifies tokens signed with
its own `JWT_SECRET`/`SESSION_SECRET` and checks its local revocation table. It
does not prove acceptance of Clerk-issued tokens or production runtime
behavior. For the full source comparison and evidence, see the
[readiness report](./AUTHENTICATED-API-READINESS.md).

## Production Clerk pair status (2026-10-21)

- **Local configuration shape: PASS.** The recorded Production Preview check
  found the canonical Production API endpoint and a configured live
  publishable-key/issuer-host match. This does not verify the issuer with the
  API owner or prove deployed token acceptance.
- **Client token format: CONFIRMED IN SOURCE.** Mobile calls Clerk's default
  `getToken()` without a named template and sends the result as a Bearer token.
- **Owner checks: REPORTED COMPLETE.** On 2026-10-21, the project owner
  confirmed the API owner verified the Production issuer and token-acceptance
  contract; API and Clerk owners approved the exact pair, identity mapping,
  and allowed client configuration; and an authorized owner checked the
  remote Production environment. No environment values or credentials are
  recorded here. This is owner-reported status, not an independent remote
  inspection from this workspace.
- **Activation: NOT ENABLED BY THAT AUDIT.** No approval flag or remote setting
  was changed there. A later read-only verification found the current workspace
  Preview inherits an enabled local flag; that does not establish the value in
  EAS's remote `production` environment. The separate
  `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH` gate remains required and does not
  close the broader native-operation and rollout requirements in Gates 3–4.

## Native Production auth verification (2026-10-21)

- The Production web Preview is **blocked** by Clerk's browser response:
  HTTP 400, `Production Keys are only allowed for domain "bluebirdjets.com"`,
  and the request-origin restriction. The observed Replit Preview origin was
  `https://cd8d8a20-320c-4224-accf-5c9dc7df2ff1-00-1ud53d7apx2xl-6jjx16uq.expo.worf.replit.dev`.
  Clerk management status reported no configured Replit-managed dashboard and
  dashboard access was unavailable, so an additional allowed-origin setting
  could not be verified. Do not assume the Preview origin can be added; use a
  web host on `bluebirdjets.com` or a Clerk-owner-confirmed accepted subdomain.
- The native path is integrated in source: the gated `@clerk/expo` provider,
  native SecureStore token cache, phone-code screens, and Main API `/api/me`
  resolution path are present. The native client does not depend on the
  Replit browser origin or add a browser `Origin` header. This is not proof of
  device sign-in, SecureStore restoration, or deployed API token acceptance.
- The checked-in EAS `production` profile selects the named `production`
  environment and store distribution. Remote EAS presence is **unverified**
  for all five required Production auth variables and `EXPO_PUBLIC_DOMAIN`.
  The workspace-only preflight found the five required variables present;
  `EXPO_PUBLIC_DOMAIN` was not configured in that preflight process, while
  the Preview launcher supplies its Preview domain at runtime. The preflight
  does not inspect the remote EAS environment.
- **Readiness: BLOCKED / NOT DEVICE-VERIFIED.** The owner must confirm remote
  variable presence and the legacy API-domain target through authorized
  Expo access, then use an existing approved Production TestFlight build on an
  owner-controlled iPhone to test sign-in, app-restart restoration, and
  sign-out. Any authenticated `/api/me` check must wait for API-owner approval
  of the controlled test. No EAS build or submission was started for this audit.

## Production Clerk web-origin status (2026-10-27)

- The authorized Clerk owner reports the Production Frontend API URL is
  `https://clerk.bluebirdjets.com`, the Production instance is accessible,
  phone sign-in/sign-up and SMS verification are enabled, and the SMS country
  allowlist includes the United States and Canada. The owner also reports the
  Clerk environment endpoint returns JSON from Replit and iPhone Safari.
- The owner has not verified the Dashboard's exact Production allowed-origin
  rules. Replit Preview is not confirmed as an approved Production origin.
  The retained 2026-10-21 HTTP 400 rejected one observed
  `*.expo.worf.replit.dev` host and reported `bluebirdjets.com` plus a
  same-domain-or-subdomain Origin rule. That historical response does not
  establish the current full allowlist or exact URL/port format.
- **Browser test: BLOCKED.** The owner is not approving any new Production
  hostname, Preview domain, or path now. No Production web test or deployment
  is authorized. Do not change Clerk domains/origins, DNS, or credentials; do
  not repeat Replit Preview tests or request host approval. Prioritize the
  existing Build 8 native iOS initialization stall.

The 2026-10-20 mock verification passed the Bluebird client/auth-gating suites,
including signed-out `/api/me` handling and local HTTP 401-to-`session_expired`
handling. Those tests use injected fetchers; they do not exercise the production
server or verify Clerk JWT claims. The API owner has not confirmed the intended
Production Clerk issuer, token/template, audience/authorized-party rules, or
subject mapping, and no approved non-production backend was available. Gates 1
and 2 therefore remain open; do not treat the mock results as backend
acceptance.

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
- [ ] In a separate approved change, connect the current UI-only provider and
      Clerk adapter to approved production requests, handle signed-out
      `/api/me` semantics, and make any `AuthContext`, screen, or navigation
      changes required by the approved design. The current flag-gated provider
      is UI-only and must not be treated as this activation.
- [ ] Keep `PRODUCTION_AUTH_AVAILABILITY` unavailable until backend acceptance,
      native behavior, error handling, and cache isolation are verified. Review
      every production-authenticated screen and shared member-data hook before
      making member requests available.

This checklist does not activate production authentication. JavaScript bundle
exports, mocked HTTP 200 responses, the presence of a key, and local API-server
source are not proof of native session behavior or production server
compatibility.
