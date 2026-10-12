# Bluebird authenticated production API readiness

## Status

The dormant authenticated client now models the supplied member contract. It
is not connected to `AuthContext`, no screen constructs it, and production
member reads and writes remain unavailable until a verified Clerk token
provider and server token compatibility are established. In local flight-read
mode, existing demo screens continue using their existing local adapters. In
production mode, profile, membership, trips, queue actions, passenger/pet
records, and trip manifests remain unavailable instead of showing local demo
member data as production data.

## Clerk Expo SDK compatibility review (2026-10-12)

**Outcome: blocked; do not install or activate Clerk on the current baseline.**

| Package | Bluebird declaration | Lockfile version |
| --- | --- | --- |
| Expo | `~54.0.37` | `54.0.37` |
| React | `catalog:` (workspace catalog pins `19.1.0`) | `19.1.0` |
| React DOM | `catalog:` (workspace catalog pins `19.1.0`) | `19.1.0` |
| React Native | `0.81.5` | `0.81.5` |
| Expo Router | `~6.0.17` | `6.0.24` |
| `@types/react` | `~19.1.10` | `19.1.17` |

The latest stable `@clerk/expo@4.10.1` advertises Expo `>=54 <58`,
React `^18 || ^19`, and React Native `>=0.75`. Resolving it with pnpm 10.26.1
under this workspace's existing policy selects `@clerk/react@6.17.8`,
`@clerk/shared@4.40.0`, and `@clerk/clerk-js@6.39.0`. Both `@clerk/react` and
`@clerk/shared` require React/React DOM `^18 || ~19.0.3 || ~19.1.4 ||
~19.2.3 || ~19.3.0-0`; Bluebird's `19.1.0` is outside those peer ranges.
The SDK's broad top-level React peer therefore does not establish compatibility.

I also resolved `@clerk/expo@2.19.0`, whose Expo peer range is `>=53 <55` and
whose top-level React peer accepts React 19. Under the current workspace policy,
its transitive graph resolves `@clerk/react@5.54.0`,
`@clerk/clerk-js@5.128.0`, and `@clerk/shared@3.48.0`. The latter two have
React/React DOM peer ranges that exclude `19.1.0`; pnpm reports these as
unmet peers. This older candidate also reports a missing required
`expo-auth-session@>=5` peer in Bluebird. The currently declared
`expo-web-browser` does not satisfy that peer.

The workspace sets `strict-peer-dependencies=false`, so pnpm completes these
lockfile-only probes with warnings rather than rejecting them. The full
transitive peer warnings were reviewed manually; neither candidate is accepted.
No Clerk package or native auth dependency was added, and the app manifest and
lockfile remain unchanged. No dependency override, React/Expo upgrade, forced
install, or package-policy change was used.

Clerk's [Expo Quickstart](https://clerk.com/docs/quickstarts/expo) recommends
installing `expo-secure-store`, `expo-auth-session`, `expo-crypto`, and
`expo-web-browser`, and configuring the `@clerk/expo` and
`expo-secure-store` plugins. Bluebird currently has only the last of those
packages (`expo-web-browser`). The quickstart also requires enabling Clerk's
Native API and configuring native app identifiers before making a native
production build. These are later activation prerequisites, not changes made
in this readiness review.

## Dormant Clerk token bridge design

For a separately approved activation, configure only
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, and use the publishable key for the exact
Clerk instance whose session tokens the production backend is configured to
verify. It is a public client key; never place a Clerk secret key in the mobile
app or an `EXPO_PUBLIC_` variable.

The future adapter should use Clerk's supported Expo `tokenCache` backed by
`expo-secure-store` rather than manually persisting session tokens. From a
Clerk-aware hook/context, implement `VerifiedProductionTokenProvider` by
calling Clerk's `useAuth().getToken()` for each explicit authenticated API
request. Do not cache a raw token in `AuthContext`, AsyncStorage, query keys, or
logs. The production API client accepts the provider only when explicitly
constructed; it is currently not constructed by any screen.

When Clerk is loaded but signed out, or `getToken()` returns `null`, the future
provider must return `null`; the client rejects the request as a token error
before calling fetch. An HTTP 401 is exposed as `session_expired`; the app must
discard that identity's authenticated data and require a valid signed-in
session before retrying. It must not fall back to the demo token or retry with
stale credentials. Authenticated query keys already include a member identity
(`productionAuthenticatedQueryKey(memberId, ...)`). When Clerk reports an
account change or sign-out, clear the prior identity's React Query data and
other member-scoped local state before exposing the new account.

This is a design only. `AuthContext` remains the active local/demo auth path;
no Clerk provider, Clerk token adapter, or authenticated production request is
connected. The checked-in API server still validates its own
`JWT_SECRET`/`SESSION_SECRET`-signed tokens, so server-side acceptance of
Clerk-issued tokens and Clerk-instance parity remain unverified blockers.

## Supported member contract

All paths below are relative to `https://bluebirdjets.com/api`. IDs in
`empty-legs` paths and their passenger/pet subpaths are positive safe numeric
IDs. Passenger and pet weights are whole pounds.

| Feature | Supported method and response |
| --- | --- |
| Signed-in state | `GET /me` returns the documented `CurrentUser`; a valid HTTP 200 response with `isAuthenticated: false` is an anonymous/signed-out result. No `userId` is added. |
| Profile | `GET /me/profile` and complete `PUT /me/profile`. The PUT requires first/last name, date-only DOB, gender, home airport, and at least one favorite city; optional phone, notification, consent, email, and `weightLbs` fields use source limits. Phone country is required when a phone is supplied. |
| Membership | `GET /membership` models the effective membership state, payment status, documented saved-payment projection, tier changes, and recent events. It is not the public plan catalog or a checkout API. |
| Trips | `GET /trips` returns `{ current, past }` of `{ leg, checklist }`. Leg IDs are numeric Empty Leg IDs; no trip UUID or booking-status field is modeled. |
| Queue | `GET /empty-legs/{id}/queue` returns the public queue array; `POST` joins and returns `QueueEntry`; `DELETE` leaves and returns `QueueStatus`. Join body only permits the documented international-pass authorization/credit options. |
| Skip line and winner | `POST /empty-legs/{id}/skip-line` accepts only optional `useCredit` and returns the neutralized `EmptyLeg`. Winner confirm and decline are `POST /empty-legs/{id}/winner/{confirm\|decline}` and also return `EmptyLeg`. |
| Empty Leg passenger/pet roster | `GET` and `POST /empty-legs/{id}/passengers`; `PATCH`/`DELETE /empty-legs/{id}/passengers/{passengerId}`; `POST /empty-legs/{id}/pets`; `PATCH`/`DELETE /empty-legs/{id}/pets/{petId}`; and `PATCH /empty-legs/{id}/passengers/{passengerId}/weight`. Both passenger and pet PATCH bodies include their full required input fields. |
| Phone ownership verification | `POST /me/phone-verification/start`, `POST /me/phone-verification/check`, and `GET /me/phone-verification/status?phoneE164=...` use the documented PIN status/results. This Bluebird Quo phone PIN is distinct from Clerk sign-in. |

The API server remains authoritative for eligibility and transitions. Queue
join requires a complete profile and active membership, an eligible published
open leg, and compliance with the one-queue-per-local-day/family rule. Members
cannot supply rank or tier. Skip-line eligibility and available credits are
rechecked by the server. A closed/departed queue cannot be left; a winner
declines instead. Winner confirmation is idempotent for the member already
awarded the leg; declining can promote the next winner. No method starts a
checkout or payment.

Public membership plans remain independent through the existing public plan
reader. The plan catalog can render without authenticated member data; purchase
behavior remains unavailable.

## Side effects and screen readiness

The client constructor is inert. Requests occur only when a caller explicitly
invokes a method and provides a non-empty token from `VerifiedProductionTokenProvider`.
The existing URL allowlist, bearer-only headers, omitted cookies, cancellation,
timeout, structured errors, response validation, and token secrecy are
preserved.

Three documented GETs can have side effects and are not called from app setup,
screen rendering, or readiness probes:

- `GET /me/profile` can synchronize verified phone fields into the profile.
- `GET /empty-legs/{id}/passengers` can insert the account-holder passenger.
- `GET /me/phone-verification/status` can update profile/Clerk verification
  data and synchronize a Sendblue contact.

The profile, membership, trips, queue, saved-passenger, and trip-passenger
screens remain guarded in production. They do not use this client and do not
show local demo account details as production data. Existing navigation and
screen appearance were not changed. The public plan catalog and public airport
search remain independent read-only flows. No phone verification, queue,
winner, passenger/pet mutation, SMS, or payment request was made.

## Remaining blockers and source limits

- Clerk is not activated in Bluebird's app session. `AuthContext` and demo
  tokens are not connected to the production client.
- The checked-in API server still signs/verifies its own `JWT_SECRET` or
  `SESSION_SECRET` tokens; it does not establish that the app's future Clerk
  session tokens are accepted. The supplied document describes Clerk bearer
  auth, but production Clerk instance parity and token compatibility remain
  unverified. The production UI stays disabled.
- The exact response body for expired/malformed-token middleware errors,
  production session lifetime, and some caught identity/provider failures are
  unknown. The client exposes HTTP 401 as a session-expiration/authentication
  error without assuming an error JSON shape.
- The supplied document's generated `NotificationPrefs.mode` schema lists
  boolean `false`, while its verified request-handler validator accepts the
  strings `off`, `all`, and `specific`. The client follows the handler's
  runtime strings; the source-document discrepancy remains unresolved.
- Admin/concierge manifest routes, charter passenger routes, trip cancellation,
  and a reusable saved-passenger library are not part of the supported member
  contract here and were not added.
- Contract shapes were source-reviewed only; no production runtime request
  was made.

## Verification

All authenticated-client cases use injected mock fetch only. Production-mode
browser checks intercept public endpoint fixtures and assert that authenticated
member endpoints are not requested. No production API was contacted.

Current Clerk-readiness checks (2026-10-12):

- `pnpm run typecheck:libs` — passed.
- `pnpm --filter @workspace/bluebird run typecheck` — passed.
- `pnpm --filter @workspace/bluebird run test:production-auth-api` — 15 passed,
  0 failed. All tokens and HTTP responses in this suite are mocks.
- `git diff --check` — passed.
- Confirmed `artifacts/bluebird/package.json` and `pnpm-lock.yaml` are unchanged.
- Confirmed the local/demo `AuthProvider` remains mounted and no Clerk provider
  or production token provider is connected to app screens.

- `pnpm run typecheck:libs` — passed.
- `pnpm --filter @workspace/bluebird run typecheck` — passed after the library
  typecheck.
- `pnpm --filter @workspace/bluebird run test:production-auth-api` — 14 passed
  in the earlier authenticated-client review.
- `pnpm --filter @workspace/bluebird run test:production-membership-plans` — passed.
- `pnpm --filter @workspace/bluebird run test:startup-stability` — 5 passed.
- `pnpm --filter @workspace/bluebird run test:network-reliability` — 11 passed.
- `EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production pnpm --filter @workspace/bluebird run test:production-queue-readiness` — 5 passed.
- `pnpm --filter @workspace/bluebird run test:membership-plans` — 2 passed.
- `pnpm --filter @workspace/bluebird exec playwright test tests/flight-passenger-flow.spec.mjs --workers=1` — 11 passed.
- `git diff --check` — passed.

The compatibility probes used `pnpm add --lockfile-only` in disposable
worktrees. The active workspace's `artifacts/bluebird/package.json` and
`pnpm-lock.yaml` were not changed.

## Changed files

Existing authenticated-client foundations:

- `artifacts/bluebird/lib/productionAuthApi.ts`
- `artifacts/bluebird/tests/production-auth-api.spec.mjs`
- `artifacts/bluebird/tests/production-queue-readiness.spec.mjs`

Changed in this readiness review:

- `artifacts/bluebird/AUTHENTICATED-API-READINESS.md`
- `artifacts/bluebird/STAGE_2B_ACTIVATION_CHECKLIST.md`
- `artifacts/bluebird/tests/production-auth-api.spec.mjs`
- `.agents/memory/clerk-expo-sdk54-peers.md`
