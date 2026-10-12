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

- `pnpm run typecheck:libs` — passed.
- `pnpm --filter @workspace/bluebird run typecheck` — passed after the library
  typecheck.
- `pnpm --filter @workspace/bluebird run test:production-auth-api` — 14 passed.
- `pnpm --filter @workspace/bluebird run test:production-membership-plans` — passed.
- `pnpm --filter @workspace/bluebird run test:startup-stability` — 5 passed.
- `pnpm --filter @workspace/bluebird run test:network-reliability` — 11 passed.
- `EXPO_PUBLIC_BLUEBIRD_FLIGHT_READ_MODE=production pnpm --filter @workspace/bluebird run test:production-queue-readiness` — 5 passed.
- `pnpm --filter @workspace/bluebird run test:membership-plans` — 2 passed.
- `pnpm --filter @workspace/bluebird exec playwright test tests/flight-passenger-flow.spec.mjs --workers=1` — 11 passed.
- `git diff --check` — passed.

## Changed files

- `artifacts/bluebird/lib/productionAuthApi.ts`
- `artifacts/bluebird/tests/production-auth-api.spec.mjs`
- `artifacts/bluebird/tests/production-queue-readiness.spec.mjs`
- `artifacts/bluebird/AUTHENTICATED-API-READINESS.md`
