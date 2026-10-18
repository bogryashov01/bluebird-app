# Clerk Account Linking Investigation

**Scope:** Read-only review of Bluebird Mobile's checked-in Clerk flow, the supplied Main Bluebird API architecture audit, and the existing Mobile integration review.

**Bottom line:** Activating a Clerk session does not link it to an existing Bluebird member. Mobile automatically sends one authenticated `GET /api/me` projection request for the active Clerk identity. That response can guide profile navigation, but does not identify a Bluebird profile/member row or authoritatively distinguish a new account from an existing account. The supplied Main API audit describes Clerk subject (`clerkUserId`) as the normal association key. It describes no general phone/email-based account linker.

## Evidence boundary

This report separates three kinds of evidence:

1. **Mobile source:** checked-in Bluebird Mobile behavior and paths listed in the source index below. These establish what this client is written to do, not what a running API does.
2. **Supplied Main API audit:** `attached_assets/0_BLUEBIRD_REAL_PRODUCTION_ARCHITECTURE_AUDIT_1792072205283.md`, dated 2026-10-15. Its findings about Main API identity and endpoints are attributed to that audit's checked-in-source snapshot. This investigation did not inspect a separate current Main API checkout or verify that its snapshot is deployed.
3. **Unverified behavior:** no live or deployment requests were made. The audit itself says it did not test production HTTP, authenticated requests, database records, app startup, migrations, or deployment behavior. No Clerk settings or account records were inspected.

`MAIN-API-INTEGRATION-REVIEW.md` states that the Main source is not present in this workspace and that `artifacts/api-server` is a separate local/legacy API. Accordingly, this report does **not** use `artifacts/api-server/src/routes/auth.ts` or its middleware as evidence for Main account linking. Its legacy SMS/grant/JWT registration flow is not a Clerk registration or linking contract.

## 1. What happens after Clerk activation

### Sign-in and sign-up

`ClerkAuthPanel` uses Clerk phone-code sign-in or sign-up resources. A successful phone-code verification activates the returned Clerk session, then navigates to `/(clerk-auth)/signed-in`. If a Clerk session is already active, the panel also navigates there. This activation establishes a Clerk identity only; it does not create or link a Bluebird profile/member in Mobile.

### Automatic Main API request

When Clerk mode is enabled and the Clerk session is loaded and signed in, `AuthContext` automatically calls `resolveClerkMember`. That resolver:

1. obtains a fresh access token from the active Clerk session;
2. sends **`GET /api/me`** to the configured Main API with that token as a Bearer token; and
3. interprets the returned `isAuthenticated` and `isProfileComplete` booleans for navigation.

The resolver can run again when the Clerk identity, API configuration, or explicit retry counter changes. It does not automatically call `GET /api/me/profile`, `PUT /api/me/profile`, `/api/me/signup-complete`, a phone-verification endpoint, or a membership endpoint. The `isMember` projection is parsed, but the resolver deliberately does not convert it into a linked/new-account decision.

Clerk mode clears legacy token/user storage and keeps the legacy Bluebird token and user null. The app therefore does not fall back to the local API's legacy JWT as a Clerk member identity.

### Follow-up requests are user-triggered, not part of activation

| User action / route | Mobile request sequence | Important limit |
|---|---|---|
| Open the Bluebird profile after the resolver reports an incomplete profile | Uses the resolver's verified `/api/me` projection, then reads **`GET /api/me/profile`** and **`GET /api/membership`**. If no verified projection is available to the loader, it first reads `/api/me`. | The profile GET is not used as startup resolution. The supplied Main audit says it may synchronize verified Clerk phone data, so it is not guaranteed read-only. |
| Open the explicit Development profile diagnostic | **`GET /api/me`**, then **`GET /api/me/profile`** only if `/api/me` says authenticated. | A manually started diagnostic, not automatic account linking; profile GET can have a side effect per the supplied audit. |
| Submit the incomplete-profile registration review | **`PUT /api/me/profile`**, followed by a single **`GET /api/me`** to check whether the profile is now complete. The save helper does not retry the write; it still performs the verification read after a failed or malformed write response. | This is a profile write, not an account-link operation. The response contract has an unresolved discrepancy described below. |
| Manually check registration status after an unconfirmed save | **`GET /api/me`**. | Read-only status check; it does not retry the profile write. |
| Load or save an airport in Clerk registration/profile editing | Airport catalog reads are made by the picker/review; a saved home-airport change uses **`PUT /api/me/profile`** and a profile reread. | Airport endpoints are not established by the supplied audit's inventory; confirm their Main API support and schema. |

The Mobile production client also declares profile, membership, trip, queue, and phone-verification operations. Their existence in client code does not mean they are called during session activation. No Mobile call to `POST /api/me/signup-complete` was found, and no current Clerk onboarding call to the Main API phone-verification start/check/status routes was found.

## 2. Main API identity and account semantics in the supplied audit

The attached audit reports these behaviors from its source snapshot:

- The cross-system subject is the Clerk string user ID (`clerkUserId` / `clerk_user_id`). The `user_profiles` and `members` records each have their own internal row ID; ordinary profile and membership lookups use the Clerk subject. The audit says there is no declared foreign key joining those tables.
- **Returning account, same Clerk subject:** the API looks up profile and active membership data for that exact Clerk ID. An active member is associated through `members.clerk_user_id`; `isMember` means active membership, not existence of any Bluebird account/profile.
- **Different Clerk subject:** the audit found no ordinary account-linking operation that searches legacy members by matching phone or email. Verified phone/email matching exists only for a particular pending Plus Family invitation flow; it is not a general account transfer/linker. Manual or other legacy reconciliation is not established by this evidence.
- The audit reports `user_profiles.clerk_user_id` and `members.clerk_user_id` as unique. It says profile phone and membership email are not unique in the inspected schema, so a repeated phone or email cannot be treated as a unique or authoritative account key.
- The normal profile/member association is already present when a record has the same Clerk subject. This is not evidence that a new Clerk subject can claim a pre-existing row under another subject.

### `/api/me` is not an account-link verdict

The supplied audit says `GET /api/me` returns flags such as `isAuthenticated`, `isMember`, and `isProfileComplete`, but not a Bluebird member ID or explicit `profileExists` field. In the audited source:

- An authenticated Clerk user with no profile row may receive `isAuthenticated: true` and `isProfileComplete: false`; `profileExists` is internal and is not included in the response.
- An incomplete profile row can produce much the same incomplete projection.
- `isMember: false` means no active membership for that subject; it does not mean there is no profile or that the person is a new Bluebird account.
- The `/api/me` handler may return an unauthenticated/guest-shaped HTTP 200 for an unauthenticated caller or for caught lookup failures. Therefore `isAuthenticated: false` is not proof that the Clerk identity is new or that no Bluebird record exists.
- A missing profile row and an empty profile returned from `GET /api/me/profile` are not a reliable “no existing Bluebird account” decision; the audit says that profile response has no `profileExists` bit either.

Mobile's resolver is fail-closed relative to these ambiguities. `resolveProjection` maps an authenticated response with `isProfileComplete: true` to `profile_complete`, and one with `isProfileComplete: false` to `profile_incomplete`. An unauthenticated projection becomes unresolved. The `isMember` value does not create `linked`, and an incomplete profile does not create `registration_required`. Network, HTTP, token, and invalid-response failures remain error states rather than evidence of a missing account.

There is a second response-shape concern: the supplied architecture audit says Main `PUT /api/me/profile` returns the saved profile, while the Mobile production client parses that PUT response as `ProductionCurrentUser`. `MAIN-API-INTEGRATION-REVIEW.md` records the mismatch against the supplied contract and says it is unresolved. The registration flow's separate `/api/me` completion read avoids treating the PUT response alone as proof of completion, but the API owner still needs to confirm the deployed response contract.

## 3. Supported profile, registration, and phone-verification paths

The supplied Main API audit identifies these existing paths; they are not all wired into Mobile:

| Endpoint | Reported purpose | Account-linking meaning |
|---|---|---|
| `GET /api/me` | Current authenticated-user/profile-completion/membership projection. | No member ID, profile-existence bit, or explicit linked/new outcome; not sufficient for safe linking by itself. |
| `GET /api/me/profile` | Reads saved profile or an empty profile shell for an authenticated Clerk subject. | Can supply profile form data, but is not an account-existence decision and may synchronize verified phone data. |
| `PUT /api/me/profile` | Validates and inserts/updates `user_profiles` on conflict by Clerk ID. Requires the full profile request described by the API. | The audited profile-creation path for a new Clerk subject. It creates/updates a profile row under that subject; the audit does not describe it as linking a different Clerk subject to an existing member row. |
| `POST /api/me/signup-complete` | Accepts a signup channel and records signup metadata; audit says it may then try the verified-contact link for a specific family invitation. | Not a general member-registration, profile-creation, or legacy-account-link endpoint. Mobile does not currently call it. |
| `POST /api/me/phone-verification/start`, `POST /api/me/phone-verification/check`, `GET /api/me/phone-verification/status` | Separate Bluebird application phone-verification flow. Start may send a PIN; check persists verification status. | Not Clerk login OTP and not an account-lookup/link operation. The Mobile registration flow does not currently use these Main API routes. |

The supplied audit says profile completion can require name, date of birth, gender, home airport, at least one favorite airport, required phone verification, and Clerk email. It also reports that `PUT /api/me/profile` upserts by Clerk ID. Thus a genuinely new Clerk identity may be able to create its own profile through the profile form and this PUT path after the backend has accepted the identity and required profile/verification conditions are satisfied. This conclusion is **not** a claim that Mobile currently knows the identity is genuinely new, that signup completion is optional, or that the deployed API accepts the Mobile request/response shape.

Clerk sign-in OTP and Bluebird application phone verification must remain separate in the explanation. Mobile's form takes a phone marked verified in the active Clerk session; the supplied Main audit describes a distinct Bluebird PIN flow. Whether verified Clerk phone possession satisfies the Main API's profile phone gate, or whether the separate Bluebird verification must be completed, requires owner confirmation. No SMS or verification request was made.

## 4. Safe outcomes and current routing

| Case | What can be concluded safely from the evidence | Current Mobile behavior |
|---|---|---|
| Returning user signs into the **same Clerk subject** already associated in Main | Main's audited source looks up records by that exact subject. If `/api/me` is authenticated and profile-complete, it can guide the app to Discover; it still does not expose a member ID or prove active membership. | `profile_complete` routes to `/(tabs)/discover`. This does not enable legacy member data; production member capabilities remain separately gated. |
| Same subject has an incomplete profile | It is authenticated but not complete; the response does not say whether the profile row is absent or incomplete. | `profile_incomplete` routes to `/account/bluebird-profile`; the profile/airport/review screens are opened only for that current Clerk subject and the expected incomplete resolution. |
| Genuinely new Clerk subject with no prior Bluebird profile | The audit's `PUT /api/me/profile` upsert can create a profile for that exact subject, after required fields and verification policy are met. A dedicated profile/member “new user” verdict is not currently furnished by `/api/me`. | Mobile's `/api/me` projection can send an authenticated incomplete user into the profile flow, but this is not a safe proof that there is no pre-existing Bluebird account under another subject. Profile completion leads through airport selection and review; after the profile write, a fresh `/api/me` must confirm completion before continuing. |
| Same person has an existing Bluebird account under another Clerk subject | No generic phone/email matching or self-service linking path is supported by the supplied audit. A phone/email match is not authority to transfer the member. | Mobile leaves the session unresolved unless the API returns a state its current projection adapter understands; it does not infer a link or create a transfer. |
| `isMember: false`, empty profile shell, or `isAuthenticated: false` | None proves “new Bluebird user.” The last may also hide a caught source-side lookup error; exact middleware behavior for foreign/expired tokens is unverified. | No linked/new mapping is made; `isAuthenticated: false` is unresolved. A valid incomplete profile projection can route to profile completion but is not reinterpreted as account absence. |
| Token, network, HTTP, malformed response, cancellation, or backend failure | Identity/membership result is unknown, not missing. | The resolver keeps an error/unresolved state; root and tab guards do not expose member-only capabilities from an error. |

`/(tabs)/discover` is the available Home destination for a complete profile (and could be available for an authoritative registered outcome under the configured readiness), but `linkedMember` readiness is false. `PRODUCTION_AUTH_AVAILABILITY` also keeps production member-data calls unavailable pending token-acceptance and identity-mapping verification. The current `/api/me` adapter does not produce `registered`, `linked`, `registration_required`, or `onboarding_required`; those are reserved semantic states for a future approved authoritative adapter. Therefore, the generic “new user” blocked journey and a distinct “existing member linked” journey are not currently driven by this automatic projection.

## 5. Work split

### Mobile-only work, once the contract is approved

- Keep the session-to-API request scoped to the active Clerk subject, and preserve the current cache clearing/stale-result protections on account change.
- Add an adapter only for a documented, authoritative Main API outcome; do not derive link/new from `isMember`, profile completeness, phone/email equality, or anonymous-shaped `/api/me`.
- Reconcile the Mobile profile PUT response parser with the API owner's confirmed contract.
- Wire only the approved registration and phone-verification sequence, then verify completion using the API's authoritative result. Do not treat a Clerk OTP as Bluebird PIN verification without policy approval.
- Keep Discover navigation separate from member-only permissions; a completed profile alone is not proof of membership or a linked legacy account.

### Main API or product/security-owner work

- Confirm the effective Clerk instance/environment and production token acceptance for Mobile.
- Specify an authoritative linked-existing / new-profile / onboarding-needed / unresolved response and its error semantics, including how it behaves when Main lookup fails.
- Define and implement an approved, auditable proof-and-conflict path if a Bluebird member record must be claimed by a *different* Clerk subject. Matching phone/email alone is insufficient.
- Confirm whether `POST /api/me/signup-complete` is required for new Mobile sign-ups and whether it is only metadata/family-invite handling as the audit reports.
- Confirm whether Clerk-verified phone satisfies profile completion or the separate Bluebird phone PIN is required, and confirm the supported verification configuration/sequence.
- Confirm the full-body `PUT /api/me/profile` response shape and whether that endpoint is the approved way for a new subject to create its initial profile.
- Confirm the deployed behavior/revision separately; the supplied audit is not a deployment attestation.

## 6. Questions for the API/product owner

1. Does the intended account match require exact same Clerk `sub`, or is there an approved path to link an existing Bluebird member created under another subject? What proof and conflict handling authorize it?
2. What response contract authoritatively distinguishes an existing linked profile/member, a genuinely new Clerk subject, incomplete onboarding, and an unresolved lookup/backend failure? Can `/api/me` return an explicit profile/member decision without collapsing failures into an unauthenticated 200?
3. Is a profile row under the same Clerk ID sufficient for account registration, or must Mobile also call `POST /api/me/signup-complete`? Does that operation have any effect beyond signup-channel metadata and the specific family-invite path?
4. For a phone-first Clerk account, does Clerk's verified phone satisfy the Main profile's phone requirement, or must the separate Bluebird phone-verification PIN flow run? Which flow is required and enabled for the intended environment?
5. Is `PUT /api/me/profile` the approved initial-profile creation operation for Mobile, and does its deployed response match the Main audit (`UserProfile`) or Mobile's parser (`CurrentUser`)?
6. Which API base URL and Clerk instance/environment pair are approved for Mobile, and what non-production evidence confirms those deployed versions and semantics?

## Source references

### Mobile

- `artifacts/bluebird/components/ClerkAuthPanel.tsx` — phone-code sign-in/sign-up activation and signed-in navigation.
- `artifacts/bluebird/context/AuthContext.tsx` — automatic resolution trigger, fresh-session identity handling, legacy token clearing, and profile-completion projection acceptance.
- `artifacts/bluebird/lib/clerkMemberResolution.ts` — `/api/me` resolver, projection mapping, navigation states, and unresolved/error mapping.
- `artifacts/bluebird/lib/productionAuthApi.ts` — Main client paths and request/response parsers.
- `artifacts/bluebird/lib/clerkBluebirdProfile.ts` — explicit profile/membership reads and PUT-then-`/api/me` completion check.
- `artifacts/bluebird/lib/productionAuthState.ts` — member-data availability and route readiness.
- `artifacts/bluebird/app/_layout.tsx`, `app/index.tsx`, `lib/clerkAuthSession.ts` — root redirect and route guards.
- `artifacts/bluebird/components/ClerkSignedInScreen.tsx` — pending/error state and redirects.
- `artifacts/bluebird/app/account/bluebird-profile.tsx`, `app/airport-picker.tsx`, `app/registration-review.tsx`, `lib/clerkProfileOnboarding.ts` — explicit profile and onboarding behavior.
- `artifacts/bluebird/CLERK-MEMBER-JOURNEY-AUDIT.md` — prior Mobile journey and legacy-versus-Clerk boundary.
- `artifacts/bluebird/MAIN-API-INTEGRATION-REVIEW.md` — current Mobile integration evidence boundary and noted response discrepancy.

### Supplied Main API evidence

- `attached_assets/0_BLUEBIRD_REAL_PRODUCTION_ARCHITECTURE_AUDIT_1792072205283.md`, sections 5–7 — reported Clerk ID keys, profile/member association, account-link limits, `/api/me` ambiguity, profile/signup/phone endpoints, and evidence boundary.
- `artifacts/api-server/src/routes/auth.ts` and `artifacts/api-server/src/middlewares/auth.ts` were intentionally **not** used to infer Main API behavior; the Mobile integration review identifies this checked-in service as separate local/legacy API source.

## Completion boundary

This report records source and supplied-audit findings only. No API or deployment request, Clerk sign-in/token acquisition, test, SMS, account/database action, configuration change, production change, or source-code change was performed. No live or deployed behavior was verified.
