# Bluebird Mobile Main API Integration Review

**Scope:** Mobile source and tests only. This review does not establish deployed Main API behavior.

## Evidence boundary

- The supplied production API contract snapshot is dated 2026-10-12 and explicitly says production runtime was not tested. Its route/schema statements are treated as supplied contract evidence.
- The supplied read-only architecture and queue audit notes report findings from a separate Main Bluebird source. They are treated as audit evidence, not as inspection of the current Main source or proof of deployment.
- The Main Bluebird source is not present in this workspace. `artifacts/api-server` is a separate legacy/local service and was not used to infer Main API behavior.
- No authenticated Development or Production request, Clerk-token acquisition, database operation, configuration change, or production mutation was made.

## Integration findings

| Mobile feature | Mobile request and behavior | Available evidence and result |
| --- | --- | --- |
| Discover | Public `GET /api/empty-legs`; response fields are validated, and transport/HTTP/JSON/schema failures remain errors rather than empty flight lists. | The source audit describes this route as public and says optional Clerk context can enrich viewer queue/winner fields. Mobile sends no Authorization header, so those optional fields may not be personalized. Discover currently does not use those fields as membership or queue authority. Whether this affects the intended Main API experience needs owner/runtime confirmation. |
| Flight details | Public `GET /api/empty-legs/{id}` with a positive numeric leg ID; malformed IDs are rejected and unsuccessful responses do not become flight details. | The source audit reports a public detail route and 400/404 behavior. The supplied evidence does not say whether viewer-specific detail fields require optional Clerk context; Mobile does not send a token. |
| Airports and home-airport selection | Public Mobile readers call `GET /api/airports/search?q=…`, `GET /api/airports?codes=…`, and `GET /api/airports/cities`. Blank search returns no results without a request; unfiltered airport browsing is rejected. A home-airport change uses the full profile update described below, then rereads the profile and verifies the airport and preserved settings. | These airport lookup paths and response shapes are exercised by Mobile tests, but are not present in the supplied 30-operation contract snapshot or the cited read-only audit endpoint inventory. Main-source support and live response compatibility remain unverified. |
| Queue read | `GET /api/empty-legs/{id}/queue`; parser expects an array of public rows and derives the viewer only from exactly one `isViewer` row. This request uses the per-request Clerk Bearer transport to support viewer identification. | Snapshot/audit evidence describes a public ranked array with optional Clerk personalization. Client parsing and error propagation match the documented shape. The queue UI remains disabled until the separate runtime verification gates are satisfied. |
| Queue join / leave | `POST /api/empty-legs/{id}/queue` with only the optional documented authorization fields; `DELETE` has no body. Join/leave are reported as successful only after the response confirms the requested leg and queue state. Mutations do not retry or fall back to demo data. | Snapshot documents optional join body, eligibility enforced by the server, aggregate `QueueEntry`/`QueueStatus` responses, and business errors including 401/402/403/404/409. Mobile checks are fail-closed. Live eligibility and response compatibility are unknown. |
| Skip the Line | `POST /api/empty-legs/{id}/skip-line` sends `{ "useCredit": true }` only after explicit confirmation and a positive existing credit count; Mobile accepts success only if the returned `EmptyLeg` identifies the viewer as effective winner. | Snapshot/audit evidence documents the route and credit request, but live credit ownership and transition behavior are unverified. Mobile does not implement checkout or claim a booking from plan pricing; only a validated effective-winner response is accepted. Do not interpret this as evidence of a paid purchase or a confirmed passenger booking. |
| Trips | Authenticated `GET /api/trips`; parser requires `{ current, past }` arrays with numeric empty-leg IDs and checklist fields. Clerk Trips renders those lists and errors separately; it does not call demo queue/trip endpoints. | Snapshot documents this list response and empty arrays. Current Mobile list behavior matches. Production trip details, manifests, checklist writes, boarding-pass issuance, and booking operations are not wired through the Main client; the related detail read can have a server-side side effect and is not treated as a harmless probe. |
| Membership and plan catalog | Authenticated `GET /api/membership` is parsed separately from `/api/me`; tier/member conflicts are surfaced as unavailable. Public `GET /api/plans` is parsed as a plan catalog. Purchase UI remains unavailable rather than simulating a purchase. | Snapshot documents membership fields; the read-only audit reports public `/api/plans`. No payment/activation behavior is inferred from these reads. |
| Profile and Personal Information | Authenticated `GET /api/me` precedes profile reads; `GET /api/me/profile` uses strict full-profile validation. `PUT /api/me/profile` sends the required full profile fields, with optional fields only when supported. Registration verifies completion with a fresh `/api/me`; settings updates reread the profile before reporting saved values. | GET and full-body PUT semantics are documented. **Response discrepancy remains unresolved:** the supplied contract snapshot says profile PUT returns `UserProfile`, while the Mobile client parses the PUT response as `CurrentUser` (without `upgradeCreditBalances`). Existing tests encode the latter shape, and prior Development evidence recorded the same projection. Without current Main source or an authorized matching runtime response, changing either side could break the deployed contract; no speculative parser change was made. |
| Notification settings and activity | Main-backed settings read notification preferences from `GET /api/me/profile`; saves use the full `PUT /api/me/profile`, then verify the refreshed preferences and unrelated account settings. | Notification preferences are part of the documented profile projection; no separate Main notification-preferences endpoint is established. The app’s notification activity feed and legacy notification controls are not evidence of a Main notification-feed or push-delivery contract. |

## Authentication and failure handling

- Protected client calls acquire a fresh Clerk token for each request, send it as `Authorization: Bearer …`, omit cookies, and do not log token values.
- Public airport, plan, flight-list, and flight-detail reads do not send Authorization headers. The queue read uses the authenticated transport for its optional viewer marker.
- Missing/failed tokens stop protected requests before fetch. HTTP 401 remains a session-expired error; other non-2xx responses, including 403, remain HTTP errors. Network, timeout, cancellation, invalid JSON, and invalid schema are distinct failures.
- `/api/me` HTTP 200 with `isAuthenticated: false` is preserved as an unauthenticated projection; it is not treated as proof that the Clerk session or Bluebird member identity is valid.
- Profile GET may synchronize verified-phone data according to the supplied snapshot. It is not used as an automatic startup/authentication probe.

## Fixes and remaining limitations

No confirmed Mobile-only code defect could be corrected without choosing between conflicting profile PUT response evidence or assuming undocumented airport/viewer-context behavior. Existing Mobile behavior remains fail-closed where authorization, identity, response validity, or queue transition is uncertain.

Still requiring confirmation from the Main API owner or an authorized matching Development environment:

1. Current deployed Main revision, selected API/Clerk issuer pairing, token acceptance, and Clerk-to-member identity mapping.
2. The actual response to profile PUT: full `UserProfile` per the supplied snapshot versus the `CurrentUser` projection used by Mobile.
3. Main support and exact schemas for the three airport lookup paths.
4. Whether Discover/detail should send optional Clerk context and which viewer fields the deployed API returns without it.
5. Live queue/trip/membership compatibility and a trusted source for Skip the Line credits. No queue join, leave, or pass action should be tested outside an explicitly approved disposable Development fixture.
6. Real Clerk-session and native-device behavior. The automated browser tests use synthetic/mock sessions; they do not prove live Clerk sign-in, native token retrieval, or device/network behavior.

No authenticated live UI was verified.

## Checks run

- PASS — `test:main-bluebird-api` (11 tests)
- PASS — `test:production-auth-api` (23 tests)
- PASS — `test:production-flight-api`
- PASS — `test:production-airport-search`
- PASS — `test:production-membership-plans`
- PASS — `test:production-queue-actions` (4 tests)
- PASS — `test:clerk-bluebird-profile` (45 tests)
- PASS — `test:clerk-notification-preferences` (22 tests)
- PASS — `test:production-queue-readiness` (6 browser tests)
- PASS — `test:clerk-notifications-screen` (10 browser tests)
- PASS — `test:clerk-personal-info-screen` (4 browser tests)
- PASS — Bluebird `typecheck` after rebuilding `lib/api-client-react` with `pnpm exec tsc -b lib/api-client-react`. The initial typecheck reported broad missing-export/field errors from stale composite output; rebuilding the package resolved them.
