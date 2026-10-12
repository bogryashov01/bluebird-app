# Bluebird authenticated API readiness

## Status

The client layer is prepared for the checked-in authenticated API contract, but
production member data and actions remain unavailable in the app. No screen
constructs or calls the authenticated production client. Production screens
show an unavailable state rather than falling back to a local `AuthContext`
member, demo API response, or fabricated production record. Existing local/demo
flows are unchanged when local flight-read mode is selected.

| Feature area | Status | Contract/readiness |
| --- | --- | --- |
| Profile read and update | Ready at client layer; blocked in production UI | `GET` and `PATCH /auth/me`; the authenticated response is the contract `User`. Phone is not editable through this route. |
| Membership status | Ready at client layer; blocked in production UI | `GET /membership`; only member status uses this authenticated operation. |
| Public membership plans | Ready and separate | Existing public `GET /plans` reader remains independent of member status. It does not authorize a purchase or establish membership. |
| Trip list and cancellation | Ready at client layer; blocked in production UI | `GET /trips` and `POST /trips/{tripId}/cancel`; trip ID remains distinct from its flight ID. |
| Passenger manifest | Ready at client layer; blocked in production UI | `GET` and `PUT /trips/{tripId}/manifest`, plus the contract's `POST /trips/{tripId}/manifest/submit`. These apply to an owned, confirmed upcoming trip, not an empty leg directly. |
| Saved passengers | Ready at client layer; blocked in production UI | `GET` and `POST /passengers`, `PUT` and `DELETE /passengers/{passengerId}`. |
| Queue status and actions | Ready at client layer; blocked in production UI | `GET /queue/status`, `POST /queue/join`, `DELETE /queue/{entryId}`, and `POST /queue/{entryId}/use-pass`. Each action must be invoked explicitly. |
| Phone ownership verification/change | Blocked | No phone-change/ownership-confirmation API is defined. Existing sign-in verification is not a substitute for changing a member's phone. |
| Per-empty-leg passenger/pet roster | Blocked | No per-flight passenger or pet endpoints are defined. The supported manifest is attached to an owned, confirmed trip. Queue join carries only the contract's initial occupant count and supported pet details. |
| Winner confirm/decline | Unsupported; automatic confirmation is the contract | The queue engine confirms eligible members automatically. There is no manual winner confirmation or decline operation. |

## Authentication compatibility

The new client accepts only an explicit `VerifiedProductionTokenProvider`; it
does not read `AuthContext`, browser storage, or the demo token. Client
construction is inert. Every request requires a caller-invoked method and a
non-empty provider token, uses the existing production API URL validator, and
supports cancellation, a timeout, and structured HTTP, JSON, schema, token,
network, and session-expiration errors. It does not log or persist tokens.

The checked-in API middleware verifies JWTs signed with `JWT_SECRET` (falling
back to `SESSION_SECRET`) and checks its own revocation store. This does not
establish that Clerk-issued tokens are accepted. Clerk is not installed or
mounted, and no token bypass or backend change was made. Do not activate
production authenticated calls until a verified provider and server token
compatibility are established.

## Isolation and verification

Authenticated client tests inject a mock fetcher; they do not use the network.
Mutations are exercised only against that mock. Production-mode browser tests
stub the public production-read endpoints as well as the local API, assert that
no production or member-data requests escape, and do not display synthetic
demo account data. The public plan catalog remains a separate read-only API.

No Clerk dependency/provider, React or Expo dependency, `AuthContext`, API
server, OpenAPI contract, generated client, secret, database, or deployment
configuration was changed. No commit or push was made.

## Test results

All browser tests intercepted local API requests and stubbed public
`bluebirdjets.com/api` reads; all authenticated-client tests injected a mock
fetcher. No production API request was made.

- `pnpm run typecheck:libs` — passed.
- `pnpm --filter @workspace/bluebird run typecheck` — passed.
- `pnpm --filter @workspace/bluebird run test:production-auth-api` — 10 passed.
- `pnpm --filter @workspace/bluebird run test:production-membership-plans` — passed.
- `pnpm --filter @workspace/bluebird run test:startup-stability` — 5 passed.
- `pnpm --filter @workspace/bluebird run test:network-reliability` — 11 passed.
- `pnpm --filter @workspace/bluebird run test:production-queue-readiness` — 5 passed.
- `pnpm --filter @workspace/bluebird run test:membership-plans` — 2 passed.
- `pnpm --filter @workspace/bluebird exec playwright test tests/flight-passenger-flow.spec.mjs --workers=1` — 11 passed.
- `git diff --check` — passed.

## Changed files

- `artifacts/bluebird/AUTHENTICATED-API-READINESS.md`
- `artifacts/bluebird/app/(tabs)/membership/index.tsx`
- `artifacts/bluebird/app/(tabs)/profile/index.tsx`
- `artifacts/bluebird/app/(tabs)/trips/index.tsx`
- `artifacts/bluebird/app/account/passengers.tsx`
- `artifacts/bluebird/app/account/personal-info.tsx`
- `artifacts/bluebird/app/membership/manage.tsx`
- `artifacts/bluebird/app/membership/plans.tsx`
- `artifacts/bluebird/app/trip/[id]/index.tsx`
- `artifacts/bluebird/app/trip/[id]/passengers.tsx`
- `artifacts/bluebird/components/ProductionAuthenticatedUnavailableNotice.tsx`
- `artifacts/bluebird/components/ProductionReadOnlyNotice.tsx`
- `artifacts/bluebird/hooks/useProductionMembershipPlans.ts`
- `artifacts/bluebird/hooks/useUnreadNotifications.ts`
- `artifacts/bluebird/lib/productionAuthApi.ts`
- `artifacts/bluebird/lib/productionAuthState.ts`
- `.agents/memory/MEMORY.md`
- `.agents/memory/production-auth-availability.md`
- `artifacts/bluebird/tests/production-auth-api.spec.mjs`
- `artifacts/bluebird/tests/production-queue-readiness.spec.mjs`
- `artifacts/bluebird/tests/startup-stability.spec.mjs`
