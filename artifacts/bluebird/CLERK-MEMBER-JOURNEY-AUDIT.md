# Audit: Clerk access to the existing Bluebird journey

**Scope:** static source and contract review only. This report does not establish deployed production behavior. No application code, API, authentication, Clerk configuration, data, or release settings were changed. No API request, sign-in attempt, SMS, test, or build was made.

## Findings at a glance

- The original phone flow resolved an account inside `POST /api/auth/verify-code`: after validating the Bluebird SMS code, the checked-in API looked up the normalized phone in its own `users` table. An existing row produced a Bluebird-signed JWT and user; no row produced a short-lived registration grant. This was not a separate lookup screen or endpoint.
- Clerk sign-in/sign-up now establishes only a Clerk session. In Clerk mode, `AuthContext` deliberately clears and withholds the legacy Bluebird JWT and user. No resolution request is made after Clerk authentication.
- `memberAccessResolved` is false in Clerk mode by construction. The root guard blocks member routes and redirects signed-in users to `/(clerk-auth)/signed-in`, whose explicit pending state says no authenticated Bluebird request has been made.
- The screens and much of their presentation remain in the app, but the original auth, registration, onboarding, and member-data assumptions are not a drop-in Clerk integration. Existing production member endpoints and authentication contracts differ materially from the local legacy API.
- Safely restoring access requires a backend-confirmed Clerk-subject-to-Bluebird-account mapping (or an approved secure claim/link process), a compatible server token verifier, and an explicit resolution response. Comparing phone numbers alone is not sufficient. Existing screens can then be adapted to the resolved production profile and API client rather than rebuilt.

## A. Original Bluebird journey

### Existing member

1. Welcome routes to the legacy phone screen when Clerk mode is off.
2. `phone.tsx` calls `useRequestLoginCode` (`POST /api/auth/request-code`).
3. `verify-code.tsx` calls `useVerifyLoginCode` (`POST /api/auth/verify-code`).
4. The local handler validates and consumes the Bluebird one-time code, normalizes the submitted phone, and queries `users.phone`. If found, it returns `{ outcome: "signed_in", token, user }`.
5. The screen stores that legacy JWT and user through `AuthContext.signIn`, clears query data, and routes to `/(tabs)/discover`.

Evidence: `artifacts/bluebird/app/(auth)/phone.tsx`; `artifacts/bluebird/app/(auth)/verify-code.tsx`; `artifacts/api-server/src/routes/auth.ts` (verify-code route); `lib/api-spec/openapi.yaml` (`/auth/request-code`, `/auth/verify-code`).

### New member

1. The same code verification finds no `users.phone` row and returns `registration_required` with a hashed-at-rest, single-use registration grant (10-minute expiry in the local handler).
2. The client stores the grant in in-memory `AuthContext` state and opens `/(auth)/complete-registration`.
3. The screen submits first name, last name, email, and the grant to `POST /api/auth/complete-registration`. The local route checks the grant, conflicts, and required fields, creates a Bluebird user, and returns a legacy JWT and user.
4. The client signs in, clears cached queries, opens the welcome tour, then enters home-airport onboarding.
5. `onboarding.tsx` reads the public airport catalog and saves selected `homeAirports` through `PATCH /api/auth/me`; success routes to Discover. It can also skip directly to Discover.

Evidence: `artifacts/bluebird/app/(auth)/verify-code.tsx`; `artifacts/bluebird/app/(auth)/complete-registration.tsx`; `artifacts/bluebird/app/(auth)/welcome-tour.tsx`; `artifacts/bluebird/app/(auth)/onboarding.tsx`; `artifacts/api-server/src/routes/auth.ts`; OpenAPI `RegistrationRequiredVerification`, `CompleteRegistrationRequest`, and `UpdateMeRequest`.

### Reusable member surfaces and their current assumptions

| Surface | Reusable work | Current identity/data boundary |
| --- | --- | --- |
| Home / Discover (`app/(tabs)/discover/index.tsx`) | Flight list/map, search, cards, and navigation are already implemented. | Public production flight reads are separate. Personalized queue/trip reads use the legacy generated client and are enabled only in local flight-read mode when `AuthContext.user` exists. |
| Profile (`app/(tabs)/profile/index.tsx`) | Profile presentation, settings, appearance, and navigation are implemented. | Reads `AuthContext.user`; membership and notification hooks are local-demo-only. Production mode deliberately shows an unavailable notice. |
| Membership (`app/(tabs)/membership/index.tsx`) | Nonmember/member layouts, plan display, and navigation are implemented. | Legacy membership hook is local-demo-only; production mode blocks personalized membership data. |
| Trips (`app/(tabs)/trips/index.tsx`) | Upcoming/pending/past presentation and trip navigation are implemented. | Legacy trips and queue hooks are local-demo-only; production mode explicitly withholds them. Cancellation and associated user updates also use legacy assumptions. |
| Registration / onboarding | Existing short-registration UI, welcome tour, airport selection, and skip path remain present. | The registration grant, `AuthContext` user/token, and `PATCH /auth/me` all belong to legacy phone auth. The Clerk-mode route guards redirect legacy phone/code/registration routes to Clerk sign-in; onboarding would lack a usable legacy token/user. |
| Auth screens | Legacy phone/code and Clerk phone/code screens both remain. | Legacy authentication issues Bluebird JWTs. Clerk authentication creates/activates a Clerk session only; it does not create or resolve a Bluebird account. |

“Reusable” here means the existing surface/flow can be adapted; it does not mean its present hooks, data shapes, or actions are already usable with Clerk. In production flight-read mode, Profile, Membership, and Trips currently show explicit unavailable states rather than production-authenticated member data.

## B. Current Clerk flow and exact navigation block

1. With Clerk enabled, `ClerkAuthPanel` uses Clerk sign-in/sign-up phone-code resources and activates the Clerk session only after Clerk returns a complete, verified flow. It then routes to `/(clerk-auth)/signed-in`. See `components/ClerkAuthPanel.tsx` and `app/(clerk-auth)/sign-in.tsx` / `sign-up.tsx`.
2. The Clerk session snapshot exposes `isLoaded`, `isSignedIn`, `userId`, `getToken`, and `signOut`. The centralized resolver now constructs the production API client only for an explicit `GET /api/me` identity check and asks Clerk for a fresh token. It does not enable member-data requests. See `lib/dormantClerkIntegration.tsx`, `lib/clerkProductionTokenProvider.ts`, and `lib/clerkMemberResolution.ts`.
3. In Clerk mode, `AuthContext` clears legacy token/user storage, sets in-memory `token` and `user` to null on identity changes, disables legacy `signIn`, and publishes `memberAccessResolved: !clerkMode && !!token && !!user`—therefore always false in Clerk mode. See `context/AuthContext.tsx` lines 61–85, 185–195, and 235–247.
4. `RootLayoutNav` calls `shouldRedirectClerkRoute(segments, memberAccessResolved)`. With no resolved member, any protected/member route is redirected to the signed-in Clerk route when Clerk says signed in, or Clerk sign-in otherwise. `shouldRedirectClerkRoute` leaves only index, Clerk-auth, welcome, and splash paths unguarded. See `app/_layout.tsx` lines 45–53 and `lib/clerkAuthSession.ts` lines 36–46.
5. `ClerkSignedInScreen` renders **“Bluebird member not linked”** and keeps ambiguous projections in the pending/unresolved state. The resolver may call `GET /api/me`, but neither a positive `isMember` projection nor a negative/anonymous projection confirms linking or registration. Request failures are shown as errors, never as missing-member evidence. See `components/ClerkSignedInScreen.tsx` and `lib/clerkMemberResolution.ts`.
6. The tab layout independently redirects Clerk-mode tabs to the signed-in Clerk route or sign-in. See `app/(tabs)/_layout.tsx` lines 153–175. Legacy auth screens also redirect to Clerk while the feature is enabled.

**Conclusion:** the app now performs a Clerk-token-backed `/api/me` projection check, but the checked-in response contains no authoritative Bluebird member identifier or explicit linked/missing/onboarding result. Every successful projection therefore remains unresolved. The route guard and `PRODUCTION_AUTH_AVAILABILITY` remain closed (`provider_not_connected` and `backend_token_compatibility_unverified` in `lib/productionAuthState.ts`).

## C. Endpoint inventory and contract comparison

Paths below include `/api` unless a row explicitly says “client path” (the production client stores paths relative to its `/api` base URL). “Local” means checked-in local API-server source plus the shared OpenAPI/client generated from it. It does not prove production deployment.

### Legacy mobile client and checked-in local API/OpenAPI

| Purpose | Endpoint and auth | Documented/local behavior | Clerk suitability |
| --- | --- | --- | --- |
| Request legacy code | `POST /api/auth/request-code`, no bearer | Phone-based Bluebird code; response may contain `demoCode` outside production. Local handler can send SMS when configured. | Not a Clerk account lookup. Do not call as part of a silent resolution path. |
| Resolve legacy account or registration outcome | `POST /api/auth/verify-code`, no bearer | Consumes the Bluebird code, checks `users.phone`, then returns either `signed_in` with Bluebird JWT/user or `registration_required` with grant. OpenAPI documents both outcomes. | This is the old lookup, but it verifies a Bluebird SMS code and identifies by the local phone field. It is not a Clerk-session resolver and must not be repurposed as proof to link accounts. |
| Create a legacy account | `POST /api/auth/complete-registration`, registration grant in body; no bearer | Creates a local user after phone-code verification and returns a Bluebird JWT/user. OpenAPI documents 400/401/409 cases. | Not a Clerk registration endpoint; Clerk mode redirects this screen away. |
| Read/update legacy user and onboarding fields | `GET /api/auth/me` and `PATCH /api/auth/me`, Bluebird bearer JWT | Local middleware verifies a JWT signed with this API's `JWT_SECRET`/`SESSION_SECRET`; GET returns the local `User`; PATCH accepts fields including `homeAirports`. | Clerk token is not shown as accepted by this middleware. |
| Public onboarding catalog | `GET /api/flights/airports`, no bearer | Returns airport groups; used by the existing airport picker. | Reusable public data source if the same route is available in the chosen production service. |
| Member queue, trips, membership, notifications | `GET /api/queue/status`, `GET /api/trips`, `GET /api/membership`, `GET /api/notifications`, bearer in OpenAPI | Generated mobile hooks use the legacy API client. OpenAPI shapes differ from the supplied production contract, especially queue/trips and membership. | Cannot simply attach Clerk to the legacy client: its shared token getter returns null in Clerk mode, and backend token compatibility is unproven. |

Checked-in API route mount is `/api` (`artifacts/api-server/src/app.ts`); route index mounts `/auth`, `/flights`, `/queue`, `/trips`, `/membership`, and `/notifications`. `authMiddleware` verifies its own JWT secret and local revocation list (`artifacts/api-server/src/middlewares/auth.ts`); it does not show Clerk issuer/signature/audience validation or Clerk-subject-to-user mapping.

### Dormant production mobile client and supplied source-derived production contract

The production client at `artifacts/bluebird/lib/productionAuthApi.ts` is explicitly isolated from `AuthContext`; construction is inert and no screen calls it. If called, it requires a `VerifiedProductionTokenProvider`, obtains a fresh token for each explicit request, sends it as a Bearer token, and separates network/timeout, HTTP, invalid-JSON, and schema errors. It has these relevant operations:

| Purpose | Production client path / method | Supplied contract meaning (source-derived; runtime unverified) |
| --- | --- | --- |
| Resolve current Clerk caller | `GET /me` (wire path `GET /api/me`) | Optional-auth endpoint. HTTP 200 can mean anonymous (`isAuthenticated:false`); caught identity/database/schema failure can also produce signed-out-looking data. It returns flags such as `isAuthenticated`, `isMember`, `isProfileComplete`, `needsSignupPhone`, and `needsPlanDecision`, but no `userId`. Thus `isMember:false` is not proof no account exists, and `isAuthenticated:false` is not proof a member is missing. |
| Read profile / onboarding state | `GET /me/profile` (`GET /api/me/profile`) | Requires Clerk bearer. Returns a profile or empty-profile defaults; may synchronize verified Clerk phone fields, so it is not strictly read-only. An incomplete profile is not itself proof no Bluebird identity/account exists. |
| Complete/update profile | `PUT /me/profile` (`PUT /api/me/profile`) | Requires Clerk bearer and a full profile request (name, DOB, gender, home airport, favorites; plus applicable phone verification and other fields). The contract describes required-profile validation and first-profile defaults. This is a potential existing onboarding target, but not the old short-registration API and not proven to create/migrate/link a legacy account. |
| Verify a Bluebird phone | `POST /me/phone-verification/start`, `POST /me/phone-verification/check`, `GET /me/phone-verification/status` | Requires Clerk bearer. The documented Bluebird PIN flow is distinct from Clerk login OTP; check/status may mutate profile and Clerk metadata. These are not account-lookup endpoints and status GET is not read-only. |
| Membership and trips | `GET /membership`, `GET /trips` | Require Clerk bearer. The contract describes membership state separately from identity; trips are `{current, past}` with numeric empty-leg identifiers. |
| Per-flight queue and other member actions | `GET /empty-legs/{id}/queue`, plus join/leave/passenger/winner operations | Contract uses per-empty-leg queue operations, not the local user's aggregate `GET /queue/status` response. Do not substitute one response for the other without an adapter/API contract. |
| Notifications | No corresponding notification operation in the supplied contract's 30 documented operations | The local mobile `GET /notifications` has no documented counterpart in this supplied contract. Production support is unverified/not specified here. |

The supplied document is titled `BLUEBIRD MOBILE PRODUCTION API CONTRACT`, dated 2026-10-12, and explicitly says production runtime tested: **NO**. It describes a Clerk Bearer token, Clerk session validation, identity resolution in its source snapshot, protected-route 401 behavior, and `/api/me`'s special signed-out HTTP 200 behavior. It also states the exact production Clerk instance parity and some malformed/expired-token behavior remain unknown. Treat this as a source-derived contract, not evidence that the deployed service has this revision, accepts this app's Clerk session, or maps legacy members.

### Material mismatches

1. **Different auth principals/token formats:** local `/api/auth/*` and member routes use Bluebird-owned JWTs (`{ userId }`, signed by local `JWT_SECRET`/`SESSION_SECRET`). Supplied production contract expects Clerk Bearer sessions. Local checked-in middleware does not demonstrate Clerk verification.
2. **Different route and body model:** local user identity is `GET/PATCH /api/auth/me` with a `User` model and partial `homeAirports` patch. Production contract uses `GET /api/me`, `GET/PUT /api/me/profile`, and richer profile data. The mobile production client models that separate contract, while the generated legacy hooks call local OpenAPI paths.
3. **Different identity response:** legacy `/auth/verify-code` returns a local user and ID. Production `/api/me` intentionally does not return a user ID; booleans/profile completeness are not a legacy-member linkage proof.
4. **Different missing-account semantics:** local verify-code has explicit `registration_required`. The supplied production `/api/me` does not document a `missing Bluebird member` outcome. An empty profile or `needsSignupPhone`/incomplete profile represents onboarding/profile state, not necessarily a missing member.
5. **Different member data:** local queue status is an aggregate authenticated list; production contract specifies queues by empty-leg ID. Production trips use `{current,past}` and numeric empty-leg ids, unlike local OpenAPI's trip array/local identifiers. Production membership response also has a separate shape. Adaptations/codegen and screen data models are needed.
6. **No guaranteed notification equivalent:** local Profile and shared tab badge consume legacy notifications; the supplied production contract does not include those operations.
7. **No current production API client call site:** the dormant Clerk token adapter/client are present, but no screen creates that client; global generated legacy API auth does not fall back to Clerk.

The supplied contract also warns that some authenticated GETs have side effects (`GET /api/me/profile`, phone-status and passenger reads). A future resolver/onboarding implementation must not use an endpoint as a harmless probe without accounting for those effects.

## D. Resolution outcomes the integration must preserve

| Result | Required evidence and behavior |
| --- | --- |
| **Confirmed existing Bluebird member** | The API has authenticated the intended Clerk identity and authoritatively returns its linked Bluebird member/profile identity. Hydrate that profile, clear or namespace prior identity caches, then enter existing member routes. An active Clerk session or matching phone/email text alone is not enough. |
| **Confirmed missing Bluebird member** | Only a success response with an explicit backend-defined “no Bluebird account for this authenticated identity” result qualifies. Offer supported signup/registration. Do not infer missing from 401, 403, 404 unless the contract explicitly defines it, an empty profile, `isMember:false`, `isAuthenticated:false`, or a timeout. |
| **Onboarding required** | The API confirms the Clerk identity/account and returns an explicit incomplete-profile/onboarding state. Reuse airport/profile onboarding only with the production profile contract and required fields; distinguish profile completion from membership purchase/plan decision. |
| **Authentication/backend failure** | Preserve as an error or unresolved identity. For example: token unavailable, 401/403, API 5xx, malformed/schema-invalid response, or the supplied `/api/me` signed-out-shaped 200. Do not offer new-account creation or link another account based on these. A 401 interpretation must follow the deployed API's confirmed semantics. |
| **Network failure/timeout/cancellation** | Keep the resolution pending/error with retry; do not mutate identity, mark a user missing, clear a valid Clerk session, or create an account. The dormant production client already has distinct network/timeout/cancel error types. |

Phone possession can be one piece of a deliberately designed linking protocol, but the server must prove the right to claim the pre-existing Bluebird record and commit the mapping securely. A matching number is an attribute match, not an account-link authorization.

## E. Missing integration and backend prerequisites

- **Authoritative identity resolution/link contract:** define how the authenticated Clerk subject maps to an existing Bluebird member, how a genuinely new Clerk identity is represented, and distinct typed outcomes for linked, unlinked/new, onboarding-required, and rejected/unresolved. The current production `/api/me` projection has no member ID and may return signed-out-shaped HTTP 200 for caught failures.
- **Verified token acceptance:** the deployed API owner must confirm the intended Clerk instance/token type, issuer, signing-key/JWKS, audience/authorized-party checks, subject mapping, expiry/revocation behavior, and response semantics. The checked-in API server's legacy JWT middleware does not supply this.
- **Safe legacy-account claim:** for existing local/legacy members, backend must provide a non-phone-only proof and an atomic, auditable mapping from Clerk `sub` to the member record. Decide recovery/conflict behavior for duplicate Clerk identities and duplicate candidate member records.
- **Supported new-member path:** confirm whether the production `PUT /api/me/profile` creates the first Bluebird profile for a signed-in Clerk user, how it represents an account with no profile, and whether phone verification is required. The contract's Quo verification/PIN endpoints are distinct from Clerk login and can send SMS; do not call them automatically or as a read-only lookup.
- **Client data contract/adapters:** reconcile local generated endpoints/schemas with the production contract, including profile, trips, membership, queue, notifications, and Discover personalization. Do not pass the Clerk token into the old local API client until server compatibility is explicitly established.
- **Lifecycle safety:** preserve query-cache clearing on Clerk identity change/sign-out, and define retry, expiry, sign-out, account-switch, and stale-data behavior before exposing any member tabs.

## F. Smallest safe implementation sequence

1. **API owner specifies and implements the authoritative contract first.** Document and verify on an approved non-production environment how Clerk subject resolves to a Bluebird record, precise outcomes/status codes, and legacy-account proof/linking. Ensure backend validates only the intended Clerk token and never treats a lookup failure as “not found.” If the supplied production service already provides this, obtain evidence of its deployed behavior and linkage semantics before client wiring.
2. **Resolve exactly once per Clerk identity/session lifecycle.** Connect the existing fresh-token provider to a dedicated production API client call; represent loading, linked, explicitly new/unlinked, onboarding-required, auth/backend error, and network error as distinct states. Check response shape and identity; treat `/api/me`'s `isAuthenticated:false` as unresolved/error, not new-user evidence. Keep the old token getter and demo storage isolated.
3. **Route linked users to the existing app.** Populate a production member/profile model or adapt existing `AuthContext`/hooks without persisting Clerk tokens in legacy storage. Clear member query data before identity changes and only set member-access-resolved after authoritative resolution. Then route to `/(tabs)/discover`; reuse existing tab and screen UI, adapting their data hooks/shapes as needed.
4. **Route a confirmed new identity through supported profile onboarding.** Reuse existing UI components where compatible, but map fields to the production `PUT /api/me/profile` contract or a backend-supported registration flow. Do not call the legacy grant endpoint, and do not assume the legacy airport-only PATCH is sufficient for the production required profile. Honor explicit phone verification and consent policy.
5. **Validate outcomes and member surfaces with fakes before any live test.** Add tests for each resolution outcome, token/error separation, cache/account switching, and existing/new route selection. Then, only after owner approval, validate backend acceptance and native session behavior in a designated non-production environment. Production requests, SMS, deployment, and release activity are separate, explicitly approved steps.

## Source index

- Legacy auth/context/routes: `artifacts/bluebird/context/AuthContext.tsx`; `artifacts/bluebird/app/_layout.tsx`; `artifacts/bluebird/app/index.tsx`; `artifacts/bluebird/app/(auth)/phone.tsx`; `verify-code.tsx`; `complete-registration.tsx`; `welcome-tour.tsx`; `onboarding.tsx`.
- Clerk routes and gate: `artifacts/bluebird/app/(clerk-auth)/sign-in.tsx`; `sign-up.tsx`; `signed-in.tsx`; `artifacts/bluebird/components/ClerkAuthPanel.tsx`; `ClerkSignedInScreen.tsx`; `artifacts/bluebird/lib/clerkAuthSession.ts`; `dormantClerkIntegration.tsx`; `clerkProductionTokenProvider.ts`.
- Reusable surfaces: `artifacts/bluebird/app/(tabs)/_layout.tsx`; `discover/index.tsx`; `profile/index.tsx`; `membership/index.tsx`; `trips/index.tsx`.
- Client/availability: `artifacts/bluebird/lib/productionAuthApi.ts`; `productionAuthState.ts`; `AUTHENTICATED-API-READINESS.md`.
- Local API/OpenAPI: `artifacts/api-server/src/routes/auth.ts`; `middlewares/auth.ts`; `routes/index.ts`; `app.ts`; `lib/api-spec/openapi.yaml`.
- Supplied contract: `attached_assets/0_BLUEBIRD_MOBILE_PRODUCTION_API_CONTRACT_1791817009725.md` (source snapshot; runtime not tested).
