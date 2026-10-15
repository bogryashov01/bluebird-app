# Bluebird Real Production Architecture Audit

**Audit date:** 2026-10-15
**Scope:** Read-only review of the checked-in Bluebird website/API source, checked-in deployment declarations, Replit deployment metadata, and environment-variable name/presence metadata.
**Evidence boundary:** This report does not claim that checked-in source is the code currently serving production. No production HTTP request, authenticated request, database query, app startup, migration, test, SMS/email, deployment, or restart was performed. No database records or secret values were read.

Evidence labels used throughout:

- **Checked-in source** — current files in this Replit checkout; says what this source is written to do, not what a deployed process is doing.
- **Deployment configuration** — checked-in `.replit` and artifact declarations; says how a deployment is intended to build/run/route.
- **Deployment metadata** — read-only metadata for the current Replit deployment; not a live endpoint or deployed-revision attestation.
- **Environment inventory** — names and presence only from the available production/development/shared variable views. Shared scope can contribute to the production and development views.
- **Development dependency source** — installed Clerk package files in this workspace; not evidence of the production bundle’s exact dependency build.
- **Unknown** — not established by the evidence collected here.

## 1. Executive summary

The checked-in deployment declarations describe a **static Bluebird web frontend and a Node/Express API service routed as one Replit application**. The API service is declared to build from `artifacts/api-server/src/index.ts`, listen on port `8080`, and mount the route collection under `/api`; the web artifact serves its static Vite build at `/` (`.replit:3–5`; `artifacts/api-server/.replit-artifact/artifact.toml:7–32`; `artifacts/bluebird/.replit-artifact/artifact.toml:12–27`; `artifacts/api-server/src/app.ts:169–183`).

**Mobile can reuse the existing API in principle; no separate Bluebird mobile backend is indicated by the current artifact configuration.** The website obtains a Clerk session token and sends it as `Authorization: Bearer …`; the installed Clerk Express middleware source accepts Bearer tokens, and the API’s route identity is a Clerk user ID (`artifacts/bluebird/src/App.tsx:413–477`; `lib/api-client-react/src/custom-fetch.ts:28–45,370–381`; `artifacts/api-server/src/app.ts:169–182`; installed dependency source cited in section 9). This is **source/dependency evidence only**; native interoperability and the live production process were not exercised.

The largest integration risks found in source/configuration are:

1. **Deployment identity is incomplete.** Replit metadata reports a public autoscale deployment, successful build, primary hostname `bluebird.jetvia.com`, and additional hostname `bluebirdjets.com`; it does not establish live DNS/routing, domain ownership, the responding API build, or parity with this checkout.
2. **`GET /api/me` can misreport backend failures as signed-out.** The handler catches all errors from its current-user lookup and returns the guest-shaped object with HTTP 200. That object also cannot expose whether a profile row exists. `isMember` is only the active membership check, not a profile-existence signal (`artifacts/api-server/src/routes/me.ts:8–34`; `artifacts/api-server/src/lib/admin.ts:122–158,227–240`).
3. **The separate Bluebird phone-PIN flow has a configuration blocker in the inspected environment inventory.** The current backend requires `QUO_PIN_VERIFICATION_ENABLED === "true"` or `POST /api/me/phone-verification/start` returns 503 (`artifacts/api-server/src/lib/phoneVerification.ts:424–447`). That variable was absent from the production, development, and shared variable views. Whether another deployment-time source supplies it is **UNKNOWN**; therefore live phone verification behavior is also **UNKNOWN**. This is distinct from Clerk sign-in verification.
4. **Profile/member association is by Clerk ID, not general phone/email matching.** New profile creation/upsert and active membership lookup use `clerkUserId`. Verified phone/email matching is implemented for the specific Plus Family invitation flow, not as a general legacy-member linker (`artifacts/api-server/src/routes/profile.ts:242–246,811–859`; `artifacts/api-server/src/lib/admin.ts:149–158`; `artifacts/api-server/src/routes/signupComplete.ts:112–138`; `artifacts/api-server/src/lib/familyService.ts:342–437`).
5. **“Bookings” are not a general first-party API resource.** Empty-leg interest is represented by a queue; awarded legs are presented as trips. There is no general `/bookings` route or `bookings`/`trips` database table in the inspected route/schema source. The charter-specific `request-booking` route is a different workflow.

Recommendation: use the existing backend and the **same Clerk instance/environment** for the native app, recreate the website’s token bridge using an Expo-compatible Clerk client, and validate it first against a matching non-production API. Confirm the domain/deployed revision and resolve the phone-PIN configuration before treating production registration as ready. No implementation was made.

## 2. Actual production deployment topology

### What is configured

| Component | Evidence | Configured behavior |
|---|---|---|
| Replit application router | **Deployment configuration:** `.replit:3–5` | `router = "application"` and target `autoscale`. |
| Bluebird web artifact | **Deployment configuration:** `artifacts/bluebird/.replit-artifact/artifact.toml:1–31` | Vite web artifact; production build serves `artifacts/bluebird/dist/public` statically at `/`, rewriting `/*` to `/index.html`. It is not the API server. |
| API artifact | **Deployment configuration:** `artifacts/api-server/.replit-artifact/artifact.toml:1–32` | API service on local port `8080`; production run command is `node --enable-source-maps artifacts/api-server/dist/index.mjs`; health path is `/api/healthz`. Its proxy paths include `/api` and selected public HTML routes such as `/flights`, `/invite`, `/blog`, and `/membership`. |
| Backend build entry | **Checked-in source/config:** `artifacts/api-server/build.mjs:13–24`; API artifact `:17–29` | `build.mjs` bundles `artifacts/api-server/src/index.ts` to `artifacts/api-server/dist/index.mjs`; production run uses that output. |
| API router | **Checked-in source:** `artifacts/api-server/src/app.ts:169–183`; `artifacts/api-server/src/routes/index.ts:79–104` | Clerk middleware runs before the API router; impersonation middleware is mounted on `/api`; the application route collection is then mounted at `/api`. |
| Development-only component sandbox | **Deployment configuration:** `artifacts/mockup-sandbox/.replit-artifact/artifact.toml:1–17` | Design/component preview artifact, not a declared production API service. The current artifact set contains the Bluebird web artifact, API artifact, and this design sandbox; no separate mobile or second first-party API artifact is declared. |

The source server listens on `PORT` (`artifacts/api-server/src/index.ts:309–315`); the production artifact sets `PORT=8080` and `NODE_ENV=production` (`artifacts/api-server/.replit-artifact/artifact.toml:20–32`). Frontend and API are therefore **configured to be routed together by the application router**, with static website content and a separate Node process behind the API service. This is a configuration conclusion, not a live trace of the Replit router.

### What deployment metadata confirms—and does not

**Deployment metadata (read-only):** the current Replit deployment reports `isDeployed=true`, public visibility, autoscale deployment type, a successful build, primary hostname `bluebird.jetvia.com`, and additional hostnames `bluebirdjets.com` and `empty-leg-finder.replit.app`. This identifies the deployment record and hostnames associated with this Replit at audit time.

**UNKNOWN:** whether `bluebirdjets.com` DNS currently resolves to this deployment, whether its HTTPS requests reach this router, which hostname users actually receive, whether the API service is healthy/responding, and whether the built image/revision matches the current checkout. The metadata returned no deployment ID, commit/revision, or source hash. No request was sent to any listed host.

### Processes, source directories, and external services

- The only declared first-party HTTP backend is `artifacts/api-server`; the website is `artifacts/bluebird`. No alternate first-party production API implementation was found in the current artifact declarations. The component sandbox and old/mobile/demo material are not used as production evidence.
- The backend connects to PostgreSQL through `DATABASE_URL` using `pg` and Drizzle (`lib/db/src/index.ts:1–14`). The actual database target and production records were not inspected.
- Source integrations include Clerk; EPD payment processing (`artifacts/api-server/src/lib/epdClient.ts:1–40`; `artifacts/api-server/src/lib/epdMode.ts:25–63`); JetInsight feed/sync logic (`artifacts/api-server/src/lib/icsSync.ts:97–118`); Quo (`artifacts/api-server/src/lib/quoConnector.ts:47,156–170,284`); Sendblue (`artifacts/api-server/src/lib/sendblueConnector.ts:23–27,413–430,526`); SendGrid (`artifacts/api-server/src/routes/webhooksSendgrid.ts:1–9,124–134`); GoTo (`artifacts/api-server/src/lib/gotoConnect.ts:31–36`; `artifacts/api-server/src/routes/webhooksGoto.ts:40–50`); HubSpot (`artifacts/api-server/src/lib/hubspotClient.ts:23–41`); and Meta CAPI (`artifacts/api-server/src/lib/metaCapi.ts:107–120,163`). These are third-party integrations, **not alternative Bluebird member APIs**. Whether they are enabled or healthy in production was not verified.
- EPD mode is selected from a persisted admin override or `EPD_MODE`, defaulting to sandbox in source (`artifacts/api-server/src/lib/epdMode.ts:27–45`). `EPD_MODE` was absent in the inspected variable inventory, but a database override may take precedence; the actual payment mode is **UNKNOWN**. This does not change the finding that there is one first-party member API.

### Startup side effects and audit boundary

The configured Node entry point imports `preboot` before the app (`artifacts/api-server/src/index.ts:1–2`). The checked-in startup path also runs table ensure/seed helpers, including home/FAQ/blog content (`artifacts/api-server/src/index.ts:279–307`), and starts background work after listening (`artifacts/api-server/src/index.ts:317–345`). Startup was deliberately not run because the task prohibits startup/import paths that may write. No workflow was restarted.

## 3. Clerk authentication architecture

### Provider, SDKs, and website sign-in

**Checked-in source:** Clerk is the primary user authentication provider. The backend declares `@clerk/express` (`artifacts/api-server/package.json:17–25`); the installed workspace dependency is `@clerk/express` 2.1.9. The frontend declares `@clerk/react` (`artifacts/bluebird/package.json:13–20`). The frontend selects `VITE_CLERK_DEV_PUBLISHABLE_KEY` in development (with a fallback) and `VITE_CLERK_PUBLISHABLE_KEY` otherwise, then constructs `ClerkProvider` (`artifacts/bluebird/src/App.tsx:76–98,770–781`).

The website uses Clerk’s prebuilt `<SignIn>` widget, with phone-code sign-in and Google described in the page source (`App.tsx:163–201`). Signup is custom: phone signup calls `signUp.create({ phoneNumber })`, activates the returned Clerk session, and directs the user through Bluebird’s separate phone step; Google signup uses Clerk’s `oauth_google` redirect (`artifacts/bluebird/src/pages/sign-up.tsx:258–318,321–337`). The website’s actual Clerk dashboard provider settings and enabled methods are **UNKNOWN**.

Clerk creates the website identity, manages the session, and issues the session token used by the client. The comments in signup source state that “Verify at sign-up” is expected off for the phone-first account-creation step; the existing-account path forwards to sign-in rather than granting access based on number entry (`sign-up.tsx:261–307`). This is source/configuration expectation, not verified Clerk-instance policy.

### Clerk verification versus Bluebird phone verification

There are two different operations:

1. **Clerk authentication/identifier verification:** Clerk handles the website’s phone-code sign-in and the Google OAuth redirect/session. The provider-level settings and live behavior were not tested.
2. **Bluebird application phone verification:** after signup, Bluebird has a separate authenticated `/api/me/phone-verification/*` workflow. The active UI sends a request to `POST /api/me/phone-verification/start`, then accepts a six-digit code through `POST /api/me/phone-verification/check` (`artifacts/bluebird/src/components/phone-verification.tsx:609–629,683–701,860–893`). The backend code is keyed to Clerk user ID and phone, and on success stores profile verification state, attaches/updates the verified phone on the Clerk user where possible, and stamps `signupVerifiedChannel` (`artifacts/api-server/src/routes/phoneVerification.ts:167–305`).

The active service’s `startVerification` requires `QUO_PIN_VERIFICATION_ENABLED === "true"` and valid Quo readiness, then reserves a PIN attempt and sends it through the Quo flow; otherwise it returns 503 (`artifacts/api-server/src/lib/phoneVerification.ts:424–447`). The inspected production/development/shared environment views did **not** contain `QUO_PIN_VERIFICATION_ENABLED`. If the deployed process receives only the inspected configuration, app-level PIN initiation is unavailable; whether another runtime source supplies the setting is **UNKNOWN**. `PhoneCollectionCard` still has a comment referring to “reply-YES Sendblue” (`artifacts/bluebird/src/components/phone-collection-card.tsx:48–50`), but the active field/UI and backend implement a code/PIN flow. Treat that comment as stale/historical, not production behavior.

### Browser/native token transport and verification

Bluebird’s browser app explicitly registers a token getter. It gets a token from the active Clerk session, then searches pending/active Clerk session resources for a usable token (`artifacts/bluebird/src/App.tsx:413–477`). The shared API client attaches `Authorization: Bearer <token>` on each request when the getter returns one (`lib/api-client-react/src/custom-fetch.ts:28–45,370–381`). The normal web client uses relative `/api/...` paths; the shared client has `setBaseUrl()` for remote/native use (`custom-fetch.ts:18–30`; generated paths such as `lib/api-client-react/src/generated/api.ts:486–499`).

The Express application configures Clerk’s global `clerkMiddleware` with a single publishable/secret key pair selected by `NODE_ENV` (`artifacts/api-server/src/app.ts:117–131,169–174`). The installed `@clerk/express` 2.1.9 middleware sets `acceptsToken: "any"` (`node_modules/.pnpm/@clerk+express@2.1.9_express@5.2.1/node_modules/@clerk/express/dist/index.mjs:201–220`), and its installed `@clerk/backend` dependency parses an `Authorization: Bearer` header (`node_modules/.pnpm/@clerk+backend@3.4.1/node_modules/@clerk/backend/dist/chunk-ZNXT7ZQM.mjs:541–552,582–594`). This is direct evidence that **the installed SDK path accepts bearer-form tokens**, but not a live request or proof of the exact dependency deployed in production.

`clerkAuth.ts` decodes a JWT `sub` only as a fallback after Clerk middleware has populated `sessionStatus`; the helper explicitly says it does not verify the signature itself (`artifacts/api-server/src/lib/clerkAuth.ts:6–26,85–110`). The pending-session branch first asks `getAuth` to treat pending sessions as signed in; `POST /api/me/signup-complete` also accepts pending sessions and falls back to the already middleware-verified `sub` (`clerkAuth.ts:29–43,85–110`; `routes/signupComplete.ts:13–31`). Do not treat the raw JWT decode as an independent authentication mechanism.

### Cookies, origin, impersonation, and other token paths

- **Cookies are not a hardcoded requirement for the member API.** The web app itself attaches a bearer token. Fetch does not set an explicit `credentials` option, so the browser’s normal same-origin credential behavior may also send cookies; the API config enables credentialed CORS with reflected origin (`artifacts/api-server/src/app.ts:45`). No native runtime was tested.
- `/api/__clerk/*` is a production Clerk Frontend API proxy that rewrites cookies/redirects to the website host (`artifacts/api-server/src/app.ts:40–45`; `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts:88–153`). It supports browser Clerk behavior; it is not the API session-validation route.
- There is a special Comms SSE workaround that copies `?token=` into `Authorization: Bearer` before Clerk middleware because browser `EventSource` cannot set headers (`app.ts:133–148`). This is specific to `/api/admin/comms/stream`, not a general query-token convention.
- Verified admin impersonation middleware runs after Clerk authentication and before member routes; it substitutes an effective user ID only when the real Clerk identity has a trusted impersonation context (`app.ts:176–182`; `artifacts/api-server/src/lib/clerkAuth.ts:112–169`; `artifacts/api-server/src/lib/impersonation.ts:25–72`). It is an admin feature, not a second login system.
- No separate Bluebird JWT issuer/authentication layer was found for normal member routes. The signed boarding-pass URL is a scoped public-link credential, and webhook secrets authenticate third-party callbacks; neither is general account authentication. The installed Clerk package and checked-in `clerkAuth` helper are the relevant API auth path.

### Validation constraints and Clerk environment

The API passes Clerk only `publishableKey` and `secretKey` to middleware; it does not pass custom `audience`, `authorizedParties`, or `jwtKey` options (`app.ts:117–131,169–174`). The installed SDK performs its own Clerk request authentication, but issuer/audience/party enforcement details at the live deployment are **UNKNOWN**. The environment inventory did not show `CLERK_JWT_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, or `CLERK_AUTHORIZED_PARTIES`; that is an inventory result, not proof those values cannot be injected elsewhere.

Development selects dev key names and `preboot.ts` mirrors `CLERK_DEV_SECRET_KEY` into `CLERK_SECRET_KEY` before Clerk’s singleton initializes (`artifacts/api-server/src/preboot.ts:1–19`; `artifacts/api-server/src/app.ts:117–125`). The production artifact sets `NODE_ENV=production`, which selects the non-dev names (`artifact.toml:20–29`; `app.ts:117–125`). **Which actual Clerk instance those configured key values identify is UNKNOWN** because values were never inspected. A mobile token must come from the same Clerk instance configured in the API process; a different Clerk Development instance will issue a different issuer/signature identity and should not be expected to authenticate against the production instance’s key pair.

### Environment variable inventory (names and presence only)

The following results are presence metadata from production, development, and shared views. Those views include shared-scope configuration and do not prove which value is injected into a running production process. No values were accessed or printed.

| Variable name | Production view | Development view | Shared view | Notes |
|---|---|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | Present | Present | Present | Production source branch uses this name. |
| `CLERK_SECRET_KEY` | Present | Present | Present | Production source branch uses this name. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Present | Present | Present | Frontend non-development key name. |
| `CLERK_DEV_PUBLISHABLE_KEY` | Present | Present | Present | Selected by the development API branch. |
| `CLERK_DEV_SECRET_KEY` | Present | Present | Present | Copied to `CLERK_SECRET_KEY` by development preboot. |
| `VITE_CLERK_DEV_PUBLISHABLE_KEY` | Present | Present | Present | Selected by the development frontend branch. |
| `CLERK_JWT_KEY` | Absent | Absent | Absent | Not passed as a custom middleware option in source. |
| `CLERK_JWT_ISSUER_DOMAIN` | Absent | Absent | Absent | Not referenced by the checked-in middleware setup. |
| `CLERK_AUTHORIZED_PARTIES` | Absent | Absent | Absent | No custom authorized-party option is passed in source. |
| `DATABASE_URL` | Present | Present | Present | `lib/db/src/index.ts` uses this name for the request-serving DB pool. |
| `PROD_DATABASE_URL` | Present | Present | Present | No use found in the request-serving DB package; do not assume it is the API’s DB. |
| `NODE_ENV` | Absent in the variable inventory | Absent in the variable inventory | Absent in the variable inventory | Production artifact explicitly sets it to `production`; API dev script sets `development` (`artifacts/api-server/package.json:6–9`). |
| `REPLIT_ENVIRONMENT` | Present | Present | Present | Presence only; does not identify which app secrets are effective. |
| `QUO_API_KEY` | Present | Present | Present | Quo PIN workflow provider credential name. |
| `QUO_PHONE_NUMBER_ID` | Present | Present | Present | Quo phone configuration name. |
| `QUO_WEBHOOK_SECRET` | Present | Present | Present | Quo webhook credential name. |
| `PHONE_VERIFICATION_HMAC_SECRET` | Present | Present | Present | Presence only. |
| `QUO_PIN_VERIFICATION_ENABLED` | Absent | Absent | Absent | If not injected elsewhere, source makes phone-PIN start return 503. |
| `EPD_MODE` | Absent | Absent | Absent | Source defaults to sandbox unless a stored override is present. |
| `EPD_API_KEY_LIVE`, `EPD_API_KEY_SANDBOX` | Present | Present | Present | Both names present; selected mode/value is not established. |
| `EPD_GATEWAY_SECURITY_KEY_LIVE`, `EPD_GATEWAY_SECURITY_KEY_SANDBOX` | Present | Present | Present | Both names present; selected mode/value is not established. |
| `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET_KEY` | Present | Present | Present | Does not prove Sendblue is the current phone-PIN provider. |

“Absent” means absent from the queried environment inventory at audit time; it does not rule out an external injection mechanism. `lib/db/src/index.ts:7–14` directly confirms that the API uses `DATABASE_URL`; no database URL or data was accessed.

## 4. Bluebird backend architecture

The API is an Express 5 application assembled in `artifacts/api-server/src/app.ts` and started from `artifacts/api-server/src/index.ts`. Incoming API routes pass through Clerk middleware and the `/api` router; webhooks that need raw bodies or vendor-specific authentication are mounted earlier (`app.ts:45–115,169–183`). The route collection mounts current-user/profile/phone/signup, plans/membership, queue/passenger/trip, and empty-leg handlers (`artifacts/api-server/src/routes/index.ts:79–104`).

PostgreSQL is the operational store via `@workspace/db`/Drizzle (`lib/db/src/index.ts:1–14`). The backend also calls external providers for identity and payment/messaging, and consumes a flight-feed integration. No second first-party Bluebird service, mobile API, or API gateway backend is declared in this repository. The frontend’s same-origin route shape is `/api/...`; for a native client the shared client provides `setBaseUrl` and a bearer-token getter, but no mobile caller currently exists in the inspected artifacts (`lib/api-client-react/src/custom-fetch.ts:18–45`).

Some apparently read-oriented member routes have write side effects and must not be used as casual “health checks”:

- `GET /api/me/profile` can self-heal a missing verified phone onto an existing profile row (`artifacts/api-server/src/routes/profile.ts:288–322`).
- `GET /api/trips/:legId` calls `getOrCreateChecklistRow` (`trips.ts:187–219`).
- `GET /api/empty-legs/:id/passengers` seeds the account-holder passenger row if absent (`emptyLegPassengers.ts:228–245`).
- `POST /api/me/phone-verification/start` may send a verification message (`phoneVerification.ts:99–150,424–447`); `POST /api/trips/:legId/boarding-pass/send` may send SMS/email (`trips.ts:286–382`); queue join and membership activation can trigger consequential work.

None of these endpoints was called during the audit.

## 5. Database identity and account linking

### Storage map

| Data | Checked-in storage and identity key |
|---|---|
| Bluebird profile and phone | `user_profiles`; a separate serial internal `id`, unique `clerk_user_id`, profile fields, E.164 phone and app verification state. There is no email column in this table. (`lib/db/src/schema/userProfiles.ts:113–169,327–330`) |
| Membership | `members`; separate serial internal `id`, `clerk_user_id`, nullable email snapshot, active/canceled/expired/pending-payment status and Base/Plus tier. Unique by Clerk ID (`lib/db/src/schema/members.ts:13–25,136`). |
| Plan definitions | `plan_pricing` stores tier, price/cadence and included pass settings; plan catalog content is read through server code/cache (`lib/db/src/schema/planPricing.ts:27–65`; `artifacts/api-server/src/routes/plans.ts:7–14`). |
| Empty-leg inventory | `empty_legs` rows represent published flight legs; upstream trip IDs can be shared by multiple legs (`lib/db/src/schema/emptyLegs.ts:42–57`). |
| Queue/booking interest | `flight_queue` relates an empty-leg ID to `clerk_user_id`; unique once per user per leg. It is a waitlist/queue, not a confirmed airline booking (`lib/db/src/schema/flightQueue.ts:6–16,63–69`). |
| Trips/checklist | `trip_checklist_progress` is unique by `(empty_leg_id, clerk_user_id)`; the trip API projects awarded/winning `empty_legs` and checklist state rather than reading a separate `trips` table (`lib/db/src/schema/tripChecklistProgress.ts:21–65`; `artifacts/api-server/src/routes/trips.ts:126–180`). |
| Passenger manifest | `empty_leg_passengers` rows carry leg ID, Clerk ID, passenger name parts, weight, gender, DOB, notes, and account-holder flag (`lib/db/src/schema/emptyLegPassengers.ts:30–72`). |
| Payment/subscription history | `payment_charges` and `subscription_events` use `clerk_user_id` to associate records to the same account; charge rows also store provider/status/amount metadata (`lib/db/src/schema/paymentCharges.ts:30–84`; `lib/db/src/schema/subscriptionEvents.ts:22–27`). |
| Family membership | `family_groups` / `family_members` represent the primary and invitee accounts. Active family membership is unique per Clerk ID (`lib/db/src/schema/familyGroups.ts:29–75,92–136`). |

The cross-system identity is **Clerk’s string user ID** (`clerkUserId`/`clerk_user_id`), not a shared internal Bluebird numeric user ID. Profile and membership tables each have their own serial row ID, but application joins and checks use Clerk ID. No foreign-key relationship tying a `members` row to a `user_profiles` row is declared in these schemas.

### First sign-in, profile creation, and membership association

- `GET /api/me` calls `getCurrentUserInfo`; that helper reads the effective Clerk ID, fetches the Clerk user, and loads membership tier and profile summary by that ID. If there is no profile row, the helper returns `profileExists:false` internally and null names; it does not create the profile (`artifacts/api-server/src/routes/me.ts:8–11`; `artifacts/api-server/src/lib/admin.ts:122–158`; `artifacts/api-server/src/lib/profile.ts:44–78`).
- First self-service profile persistence is `PUT /api/me/profile`, which inserts or updates `user_profiles` on conflict by Clerk ID (`artifacts/api-server/src/routes/profile.ts:495–525,570–579,811–859`). A separate phone-verification completion path can create an incomplete profile row before the full profile form is saved (`phoneVerification.ts:215–235`).
- Profile completeness is not merely row existence. The checked-in helper requires names, DOB, gender, home airport, at least one favorite airport, required phone verification, and a Clerk email (`artifacts/api-server/src/lib/profile.ts:80–118`).
- Existing members are found by active `members.clerk_user_id`/Clerk ID. `getActiveMemberTier()` checks an active row for the exact Clerk ID (`artifacts/api-server/src/lib/membership.ts:121–140`). Membership activation requires a complete profile and passes that same Clerk ID into the subscription service (`artifacts/api-server/src/routes/membership.ts:465–490,537–550`). This is the normal account association mechanism; the source does not match a new Clerk identity to an existing membership by phone/email.
- A new Clerk user with no local profile is therefore an authenticated Clerk account but not yet a complete Bluebird profile. A returning Clerk user gets their existing local rows by the same Clerk ID. If the same person signs in through another Clerk instance/account ID, there is no generic phone/email relinking path in these handlers.

### Phone/email matching, uniqueness, and duplicates

The only evidenced automatic phone/email association is the **Plus Family invitation** path. Signup completion passes phone/email only when Clerk marks the contact verified (`signupComplete.ts:112–138`); family service searches an invited row by invitation token, then verified phone, then normalized email, with proof checks for the specific-invite path (`familyService.ts:342–437`). This links a particular pending family invite; it does not transfer a general Bluebird member record.

Same-ID duplicate protections exist: `user_profiles.clerk_user_id` and `members.clerk_user_id` are unique, and profile PUT uses an upsert. However, `user_profiles.phone_e164` has no unique index in the inspected schema; `members.email` is not unique. Thus the schema does not by itself prevent two different Clerk IDs from carrying the same phone/email. Whether Clerk itself prevents duplicate identifiers within its configured instance is an instance-setting question, not verified here. No personal database rows were read.

**Answer to “which operation links an existing Bluebird member to Clerk?”** For the ordinary membership flow, there is no phone/email match operation found: the member’s Clerk ID must already match. Verified phone/email matching exists only for a specific Plus Family invite. Any legacy/manual account reconciliation outside those paths is **UNKNOWN**.

## 6. API endpoint inventory

The OpenAPI document declares server base `/api` (`lib/api-spec/openapi.yaml:7–9`), and the application mounts the route collection at `/api` (`artifacts/api-server/src/app.ts:182`). Paths below are fully mounted paths. “Auth required” means the route’s own identity/ownership check; normal API routes also pass through the global Clerk middleware. OpenAPI/generated types are declarations; handler source is the source of truth for the behavior summarized here.

| Method and mounted path | AuthN / AuthZ | Request and response format; notable errors/behavior | Handler and declared contract |
|---|---|---|---|
| `GET /api/me` | No route-level login requirement; Clerk context is optional. | No body. JSON current-user summary (`isAuthenticated`, `isMember`, tier, names, completeness, etc.). Handler catches lookup errors and returns the guest-shaped summary with **HTTP 200**. See the dedicated state table below. | `routes/me.ts:8–34`; OpenAPI `/me` `openapi.yaml:42–54`; `lib/admin.ts:122–158,227–240`. |
| `GET /api/me/profile` | Requires a resolved effective Clerk user ID; otherwise 401. | No body. JSON profile shell or saved profile. Missing local row is 200 and includes an empty profile plus available Clerk email/phone/signup metadata. Saved-row response has `isComplete`; no `profileExists` bit. A saved-row GET may self-heal phone data in DB. | `routes/profile.ts:235–369`; OpenAPI `/me/profile` `openapi.yaml:56–78`; `EMPTY_PROFILE` at `profile.ts:110–135`. |
| `PUT /api/me/profile` | Requires effective Clerk user ID; 401 otherwise. | JSON `UpdateUserProfileRequest`; validates names, adult DOB, gender, existing home airport, favorite city keys, phone/country/verification, email and notification/consent constraints. 400 on invalid input/unknown city/airport; 200 returns profile; unexpected DB/provider errors go to Express error handling. Upserts by Clerk ID. | `routes/profile.ts:495–590,639–763,811–859,1128–1168`; OpenAPI `openapi.yaml:79–115,20825–20927`; Zod body `lib/api-zod/src/generated/api.ts:331–345`. |
| `POST /api/me/signup-complete` | Requires a Clerk session; explicitly supports valid pending signup sessions. | JSON channel (`phone` or `email`); checks the selected identifier against the Clerk user, records metadata, then best-effort tries the verified-contact family invite link. JSON `{ok:true}` on completion; 400 invalid channel, 401 unresolved identity. | `routes/signupComplete.ts:13–48,99–146`; OpenAPI `/me/signup-complete` `openapi.yaml:117–165`. |
| `POST /api/me/phone-verification/start` | Requires effective Clerk ID. | JSON `{countryIso2, phoneE164}`. Returns `{ok:true,cooldownSeconds}` or 400 validation, 401, 429 rate limit, 502 provider rejection, 503 unavailable/configuration. May send an outbound verification PIN. In source, start is disabled unless Quo PIN configuration is enabled. | `routes/phoneVerification.ts:99–150`; service `lib/phoneVerification.ts:424–447`. |
| `GET /api/me/phone-verification/status?phoneE164=…`; `POST /api/me/phone-verification/check` | Authenticated by effective Clerk ID. | GET polls status for the user/phone; POST body includes `phoneE164` and a six-digit `code`. Successful verification returns status/profile/clerk-warning data and persists verification state; invalid/expired/rate-limited attempts return error statuses. | `routes/phoneVerification.ts:154–213,215–305`; active web calls at `artifacts/bluebird/src/components/phone-verification.tsx:683–701`. |
| `GET /api/plans` | Public. | No body. JSON plan catalog with pricing/cadence/features. | `routes/plans.ts:7–14`; OpenAPI `openapi.yaml:2759–2775`. |
| `GET /api/membership` | Requires effective Clerk ID; 401 otherwise. | No body. JSON membership snapshot, including the member/current billing state and recent subscription-event view produced by the response builder. | `routes/membership.ts:455–463`; `lib/membership.ts`; OpenAPI `openapi.yaml:2777–2795`. |
| `POST /api/membership/activate` | Requires effective Clerk ID and complete profile; profile-incomplete is 403. | JSON activation/tier/billing/ToS/invite data. Can activate/change a paid membership or schedule a tier change; **not a read-only or “free placeholder” call**. Validation/ToS can return 400; signup switch can return 403; billing/provider work may have external effects. | `routes/membership.ts:465–490,495–550`; OpenAPI description at `openapi.yaml:2797–2815` is stale where it says “currently free … placeholder” (`:2808–2809`). |
| `GET /api/empty-legs` | Public; optional Clerk context enriches viewer-specific queue/winner fields. | Query filters include route, past/time-window and international filters; invalid query/window is 400. JSON published-leg list; response is stripped of client pricing. | `routes/emptyLegs.ts:291–320,425–435`; OpenAPI `/empty-legs` `openapi.yaml:1065–1127`. |
| `GET /api/empty-legs/:id` | Public, only published/valid route is surfaced. | Integer path ID; JSON leg detail, 400 invalid ID, 404 missing/unpublished/invalid route. | `routes/emptyLegs.ts:437–552`; OpenAPI `openapi.yaml:3903–3927`. |
| `GET /api/empty-legs/:id/queue` | Public. | Integer leg ID; JSON ranked queue with position, initials, tier/priority and viewer marker; 400 or 404 for invalid/unavailable flight. | `routes/queue.ts:571–622`; OpenAPI `openapi.yaml:3063–3094`. |
| `POST /api/empty-legs/:id/queue` | Requires effective Clerk ID; profile/membership/pass/leg rules also apply. | Optional JSON `{internationalPassAuthorized, useInternationalPassCredit}`. Success returns queue entry; 400 invalid body, 401, 402 pass authorization, 403 profile/eligibility, 404, 409 queue/same-day conflict. It joins a queue; it does not purchase/confirm an airline ticket. | `routes/queue.ts:624–665`; OpenAPI `openapi.yaml:3095–3168`. |
| `DELETE /api/empty-legs/:id/queue` | Requires effective Clerk ID. | No body; JSON queue status. Can return 400/401/404 and business-rule errors. | `routes/queue.ts:668–692`; OpenAPI `openapi.yaml:3169–3197`. |
| `GET /api/trips` | Requires effective Clerk ID; 401 otherwise. | No body; JSON `{current:[…],past:[…]}`, with leg summary and checklist view. 500 on list failure. Derived from awarded/effective-winner empty legs; not a `trips` table. | `routes/trips.ts:126–185`; OpenAPI `openapi.yaml:3740–3762`. |
| `GET /api/trips/:legId` | Requires effective Clerk ID and trip ownership/winner status; 401/400/403/404. | JSON `{leg,checklist}`. The handler creates a checklist row if missing. | `routes/trips.ts:55–103,187–219`; OpenAPI `openapi.yaml:3764–3799`. |
| `POST /api/trips/:legId/checklist/:step` | Authenticated owner/winner only. | No body; `step` is `confirmed`, `fboVerified`, `manifestAck`, or `policyAck`; JSON updated trip detail; 401/403 and input/route errors. | `routes/trips.ts:221–284`; OpenAPI `openapi.yaml:3801–3836`. |
| `POST /api/trips/:legId/boarding-pass/send` | Authenticated owner/winner only. | No body; JSON `{sent,boardingPassUrl}`. May send email/SMS and updates sent state. | `routes/trips.ts:286–382`; OpenAPI `openapi.yaml:3838–3868`. |
| `GET /api/empty-legs/:id/passengers` | Authenticated effective winner/owner only. | No body; JSON `{passengers,passengerCap,pets}`. GET may seed the account-holder manifest seat. | `routes/emptyLegPassengers.ts:228–245`; OpenAPI `openapi.yaml:3330–3370`. |
| `POST /api/empty-legs/:id/passengers` | Authenticated owner/winner; manifest must be unlocked. | JSON passenger name parts, DOB, gender, positive weight, optional notes; returns updated manifest. 400 validation, 401/403, 404, 409 cap. Server enforces cap transactionally. | `routes/emptyLegPassengers.ts:248–331`; OpenAPI `openapi.yaml:3371–3428`. |
| `PATCH` / `DELETE /api/empty-legs/:id/passengers/:passengerId` | Authenticated owner/winner; writes require unlocked manifest. | PATCH updates passenger fields and may update the account-holder’s profile. DELETE returns updated manifest; protects the account-holder seat (400) and returns 404 for missing passenger. | `routes/emptyLegPassengers.ts:334–388,391–478`; OpenAPI `openapi.yaml:3430–3528`. |

There is no general `/api/bookings` operation or `bookings`/`trips` table in the inspected mounted routes/schema exports (`artifacts/api-server/src/routes/index.ts:79–189`; `lib/db/src/schema/index.ts:1–60`). The empty-leg queue is the closest member-facing “booking” operation. A distinct charter workflow has `POST /api/charter-requests/:id/request-booking` (`artifacts/api-server/src/routes/charter.ts:375–404`); it is not an empty-leg flight booking endpoint.

### `/api/me` decision table

| Situation | Checked-in `GET /api/me` result | What it does **not** establish |
|---|---|---|
| No valid user identity reaches the handler (ordinary unauthenticated request) | HTTP 200; `isAuthenticated:false`, `isMember:false`, null identity/name fields, incomplete profile, `needsSignupPhone:false` (`me.ts:17–31`; helper’s no-ID branch `admin.ts:125–140`). | It does not distinguish an anonymous visitor from every invalid/expired/wrong-instance-token case; those may be handled by Clerk middleware before the route. |
| Authenticated Clerk user, no `user_profiles` row | HTTP 200; `isAuthenticated:true`, `firstName/lastName:null`, `isProfileComplete:false`; `needsSignupPhone` may be true unless a verified Clerk phone or signup channel exists (`admin.ts:164–189,227–240`; `profile.ts:44–78`). | The response does not include internal `profileExists`; clients must not use `isMember` as a substitute. |
| Authenticated user with an incomplete profile row | HTTP 200, authenticated; names may be empty strings, `isProfileComplete:false`; phone/signup gate is computed separately. | `GET /api/me` still does not tell the client explicitly whether an incomplete row exists. Use `GET /api/me/profile` for form data, not as an existence bit. |
| Authenticated user with a complete profile row | HTTP 200, authenticated, `isProfileComplete:true`; `needsPlanDecision` may still be true. | Profile completion does not imply an active paid membership. |
| Existing active member | `isMember:true` and `memberTier` reflect an active `members` row for the same effective Clerk ID (`admin.ts:149–158,227–240`; `membership.ts:131–140`). | It does not prove a profile row exists. `isMember` means active membership, not “Bluebird account/profile exists.” |
| No active member row | `isMember:false`, `memberTier:null`, regardless of whether a profile row exists. | It does not mean the user is a new account or lacks a saved profile. |
| Clerk user fetch or profile/member DB resolution throws after the handler starts | The catch returns the guest-shaped response with HTTP 200 (`me.ts:8–34`). | It is indistinguishable from the ordinary signed-out response to clients unless they inspect logs; this is an ambiguous failure outcome. |
| Clerk middleware rejects/redirects/errors before the route, or pending-token resolution differs | Exact HTTP result is **UNKNOWN** without runtime verification. Pending resolution is explicitly handled in `getEffectiveAuth` and signup completion (`clerkAuth.ts:85–110`; `signupComplete.ts:13–31`). | Do not assume all malformed/expired/foreign tokens become the route’s guest-shaped 200. |
| Verified admin impersonation | Member checks can use the target/effective Clerk ID; the helper can include impersonation context (`clerkAuth.ts:151–169`; `app.ts:176–182`). | Returned membership/profile data may describe the target rather than the admin who owns the original token. |

### `GET` and `PUT /api/me/profile` semantics

- `GET` requires authentication. If there is no local row it returns HTTP 200 with an empty shell and can prefill email/phone from Clerk; there is no explicit `profileExists` field. If a row exists but lacks a stored phone, the handler may write a verified Clerk phone back to the DB while responding (`profile.ts:248–281,288–322`).
- `PUT` requires authentication and validated JSON. It upserts on `user_profiles.clerk_user_id`; it does not match a profile by phone/email (`profile.ts:495–525,570–579,811–859`). It writes the submitted profile and returns the saved profile (`:1128–1168`). The generated schema coerces `dob` to a JavaScript `Date`, while the handler deliberately returns the stored `YYYY-MM-DD` string for date inputs (`profile.ts:332–337`; `lib/api-zod/src/generated/api.ts:116–120`). Native code should follow the wire contract’s date string, not assume the server emits a timestamp.

## 7. Mobile compatibility assessment

Answers to the ten requested questions:

1. **Can React Native/Expo authenticate with Clerk and call this API?** Yes in architecture: use a native Clerk client tied to the same Clerk instance, obtain that user’s session token, then call the existing API. The website already demonstrates token forwarding; there is no native app or native test in this repository.
2. **Does the backend support `Authorization: Bearer <Clerk session token>`?** Yes at checked-in middleware/dependency-source level: Bluebird sends that header, Clerk Express accepts tokens, and installed Clerk Backend parses Bearer headers. Production support remains unverified.
3. **Are browser cookies required?** No API route is written to require a browser cookie; Bearer auth is the existing explicit path. The browser may also send same-origin cookies by fetch defaults, and Clerk’s browser FAPI proxy is separately configured. Native clients should send the token header, not depend on browser cookies.
4. **Are mobile-specific API endpoints needed?** Not for the audited profile, plan, membership, empty-leg search/queue, trip/checklist, or passenger flows. The existing paths are usable if native UI implements their current rules and formats.
5. **Can mobile reuse profile, membership, and trip routes?** Yes by source: `GET/PUT /api/me/profile`, `GET /api/membership`, `GET /api/trips`, trip detail/checklist and manifest routes all exist. They need the same identity and the same owner/profile/manifest gates.
6. **Must mobile use the same Clerk instance?** Yes. The API process configures one Clerk key pair at a time and has no multi-instance token routing. Mobile tokens must be verifiable by the instance selected by that process.
7. **What if mobile uses a different Clerk Development instance?** Its token will not represent the production API’s configured Clerk identity; session verification should fail or resolve unauthenticated. A Development app must call an API configured for the matching Development instance. Exact current deployment behavior was not tested.
8. **Is a separate mobile backend necessary?** No evidence requires one. The existing API is the preferred shared backend; a separate backend would create avoidable account/data divergence.
9. **Can registration be reused?** The API-level identity/profile steps can be reused (`POST /api/me/signup-complete`, phone verification, and `GET/PUT /api/me/profile`), but the current web signup pages use React Clerk widgets and browser redirects. Expo must implement a native Clerk flow and reproduce Bluebird’s separate PIN verification and profile-completion gates. The missing inspected `QUO_PIN_VERIFICATION_ENABLED` setting is a blocker to verify before promising signup parity.
10. **Minimum safe work?** Confirm the public API base URL and exact deployed revision; configure the native app with the matching environment’s Clerk publishable key (never a secret); have the native Clerk SDK return a session token and attach it as Bearer; set its API base URL; validate on a matching non-production API using a test account; cover `/api/me` states, profile, plans/membership, flight search/queue and trip/manifest ownership; and confirm the phone-PIN configuration plus cross-origin/browser policy where applicable. Do not test payment activation, queue join, or message-sending paths against production as a connectivity check.

**Native-specific compatibility caveats:** the API’s response types do not identify profile-row existence; GET profile and trip detail/manifest can have DB writes; app-level verification is distinct from Clerk login; the public queue is not a booking confirmation; and some read/list operations require winner ownership. Those semantics must be represented in mobile error handling and UX.

## 8. Confirmed facts versus unknowns

**Evidence classifications used in this audit:**

- **Checked-in source:** current repository application code and schema; establishes intended implementation, not a running deployment.
- **Deployment configuration:** `.replit` and artifact declarations; establishes intended build/run/router settings, not live request routing.
- **Deployment metadata:** the read-only Replit deployment summary; confirms the reported deployment state and hostnames, not DNS ownership, routing, API health, or code revision.
- **Development environment/dependency evidence:** variable-name presence from development/shared views and the locally installed Clerk dependency source. Neither proves the values or dependency build used by a running process; no development app runtime was started.
- **Production runtime:** no authenticated or unauthenticated production endpoint, process, or production log was inspected. Live API behavior, effective configuration, and deployed revision are therefore **UNKNOWN** unless explicitly established by deployment metadata.
- **Historical/unused code:** stale comments or declarations are identified as such and are not treated as current runtime behavior.

| Topic | Confirmed from inspected evidence | Still unknown |
|---|---|---|
| Deployment shape | Replit application router/autoscale declaration; separate static web and Node API artifact declarations; API entry/build/run commands and configured path routing. | Actual live routing, domain DNS/ownership, router behavior for any individual request, API health, and source/deployed revision parity. |
| Production metadata | Deployment metadata reports deployed/public/autoscale/successful build and the hostnames listed in section 2. | Whether `bluebirdjets.com` is currently served by this deployment, and the deployed image’s commit/source hash. |
| Clerk provider | Checked-in website/backend use Clerk SDKs; website has phone-code/Google UI; backend applies Clerk middleware; client sends Bearer; installed dependency source accepts Bearer. | Live SDK build, enabled Clerk instance settings, provider success, token acceptance by live API, effective Clerk instance, and native login behavior. |
| Auth validation | Source supplies one key pair per process and no explicit custom issuer/audience/authorized-party/JWT-key options. Pending sessions and trusted admin impersonation have code paths. | Whether the production process has any externally injected constraints/configuration, and exact live token validation response. |
| Environment | Presence-only names are listed in section 3. `DATABASE_URL` is the checked-in server DB variable; production artifact declares `NODE_ENV=production`. | Which shared/production value is effective at runtime; actual database host, whether it is production DB, and actual Clerk instance. |
| Phone PIN | Current active UI/backend use a six-digit Quo PIN path; source returns 503 unless `QUO_PIN_VERIFICATION_ENABLED` is `"true"`. The name is absent from inspected env views. | Whether another deployment configuration supplies the toggle, whether production start is currently available, and provider delivery/verification health. |
| User/member association | Profile/member rows use Clerk ID; same-Clerk-ID uniqueness exists; verified phone/email matching exists for Plus Family invites. | Current production row state, how any historical manual reconciliation was done, whether duplicate identities exist, and Clerk-side duplicate identifier settings. |
| API semantics | Routes and current request/response logic are present in source; major OpenAPI mismatches are identified below. | Current production contracts, response codes, data-dependent edge cases, and real-client interoperability. |
| Data | Schemas define profile, members, plans, flight queue, trips/checklist, passenger and payment records. | No personal records or database contents were queried; no claims are made about actual row counts, identity completeness, or data integrity. |
| Third-party services | Source contains integrations for Clerk, PostgreSQL, EPD, JetInsight ICS and messaging/operations providers. | Which integrations are enabled/healthy in production and which records are connected to them. |

### Contract drift to account for

- OpenAPI describes `GET /api/me` as returning current-user status but does not describe the handler’s catch-to-guest HTTP 200 behavior (`openapi.yaml:42–54`; `routes/me.ts:8–34`).
- OpenAPI says the no-profile profile response has null fields; the handler adds available Clerk email/phone/signup metadata and does not expose profile existence (`openapi.yaml:56–78`; `routes/profile.ts:248–281`).
- Generated Zod profile response parses DOB as a date, while the handler intentionally returns `YYYY-MM-DD` text (`lib/api-zod/src/generated/api.ts:116–120`; `routes/profile.ts:332–337`).
- The OpenAPI membership activation description still calls the flow a free placeholder, while the handler has profile/ToS/signup gates and calls tier activation/change logic (`openapi.yaml:2797–2815`; `routes/membership.ts:465–550`).
- `PhoneCollectionCard` comments describe the old reply-YES Sendblue path, but the current active input submits a six-digit PIN and the server’s start function requires the Quo PIN switch (`phone-collection-card.tsx:48–50`; `phone-verification.tsx:683–701`; `phoneVerification.ts:424–447`). Treat the comment as stale code documentation.

## 9. Exact source-file references

All paths below are relative to the repository root. Line ranges identify the checked-in passages supporting the report; installed dependency paths are explicitly not checked-in application source.

| Source | Relevant lines / claim |
|---|---|
| `.replit` | `3–5`: application router and autoscale deployment target. |
| `artifacts/api-server/.replit-artifact/artifact.toml` | `1–32`: API artifact, port/path routing, build/run/health and production `NODE_ENV`. |
| `artifacts/bluebird/.replit-artifact/artifact.toml` | `1–31`: static frontend build and SPA rewrite. |
| `artifacts/mockup-sandbox/.replit-artifact/artifact.toml` | `1–17`: design-only component preview service, not a declared production backend. |
| `artifacts/api-server/build.mjs` | `13–24`: API build entry and output directory. |
| `artifacts/api-server/package.json` | `6–10`: development `NODE_ENV` and build/start scripts. |
| `artifacts/api-server/src/index.ts` | `1–2,279–315,317–345`: preboot import, startup DB helpers, listener and post-listen work. |
| `artifacts/api-server/src/preboot.ts` | `1–19`: development Clerk secret remapping before imports. |
| `artifacts/api-server/src/app.ts` | `40–55,117–148,150–183`: Clerk proxy, CORS, key selection, SSE token shim, middleware ordering, impersonation and `/api` mount. |
| `artifacts/api-server/src/routes/index.ts` | `79–189`: mounted API routes; checked for absence of a general bookings route. |
| `artifacts/api-server/src/lib/clerkAuth.ts` | `6–26,85–110,112–169`: bearer-sub fallback is unverified by itself; pending session resolution; effective identity/impersonation. |
| `artifacts/api-server/src/routes/me.ts` | `8–34`: `/api/me` current-user response and 200 guest-shaped catch response. |
| `artifacts/api-server/src/lib/admin.ts` | `122–158,164–189,227–240`: no-ID result, profile/member lookups, signup-phone condition, `isMember` meaning. |
| `artifacts/api-server/src/lib/profile.ts` | `44–78,80–118`: internal profile-existence summary and completeness rules. |
| `artifacts/api-server/src/routes/profile.ts` | `235–369,495–590,639–763,811–859,888–900,1128–1168`: profile GET/PUT, validation, writes, email handling, response. |
| `artifacts/api-server/src/routes/phoneVerification.ts` | `99–150,154–213,215–305`: phone start/status/check and account/profile synchronization. |
| `artifacts/api-server/src/lib/phoneVerification.ts` | `424–447`: Quo PIN toggle/readiness gate and start attempt. |
| `artifacts/bluebird/src/App.tsx` | `76–98,163–201,413–477,770–781`: Clerk keys/provider/sign-in and session-to-Bearer bridge, including pending sessions. |
| `artifacts/bluebird/src/pages/sign-up.tsx` | `258–318,321–337`: phone account creation, existing-identifier forwarding, Google signup redirect. |
| `artifacts/bluebird/src/components/phone-verification.tsx` | `609–629,683–701,860–893`: active PIN request/verification UX. |
| `artifacts/bluebird/src/components/phone-collection-card.tsx` | `48–50`: stale reply-YES comment, contrasted with active UI/backend. |
| `lib/api-client-react/src/custom-fetch.ts` | `18–45,343–388`: optional base URL, token-getter interface and Bearer header attachment. |
| `artifacts/api-server/src/routes/signupComplete.ts` | `13–48,99–146`: pending signup identity, metadata and verified family-link call. |
| `artifacts/api-server/src/lib/familyService.ts` | `342–437`: invitation proof and token/phone/email matching rules. |
| `lib/db/src/index.ts` | `1–14`: PostgreSQL pool uses `DATABASE_URL`. |
| `lib/db/src/schema/userProfiles.ts` | `113–169,327–330`: profile/phone fields and unique Clerk ID index. |
| `lib/db/src/schema/members.ts` | `13–25,136`: membership rows, status/tier and Clerk ID unique index. |
| `lib/db/src/schema/planPricing.ts` | `27–65`: Base/Plus plan pricing/config storage. |
| `lib/db/src/schema/emptyLegs.ts` | `42–57`: flight-leg storage and upstream trip identity note. |
| `lib/db/src/schema/flightQueue.ts` | `6–16,63–69`: queue rows and per-leg/per-user uniqueness. |
| `lib/db/src/schema/tripChecklistProgress.ts` | `21–65`: trip checklist keyed by leg and Clerk ID. |
| `lib/db/src/schema/emptyLegPassengers.ts` | `30–72`: passenger manifest records and account-holder uniqueness. |
| `lib/db/src/schema/paymentCharges.ts` | `30–84`: payment ledger linked to Clerk ID. |
| `lib/db/src/schema/subscriptionEvents.ts` | `22–27`: subscription events linked to Clerk ID. |
| `artifacts/api-server/src/lib/membership.ts` | `121–140`: active member/tier query by Clerk ID. |
| `artifacts/api-server/src/routes/membership.ts` | `455–550`: membership read, activation gates and side-effecting tier flow. |
| `artifacts/api-server/src/routes/plans.ts` | `7–14`: public plan catalog. |
| `artifacts/api-server/src/routes/emptyLegs.ts` | `291–320,425–467`: flight search/detail and optional viewer context. |
| `artifacts/api-server/src/routes/queue.ts` | `571–692`: public queue view and authenticated join/leave. |
| `artifacts/api-server/src/routes/trips.ts` | `55–103,126–219,221–284,286–382`: owner check, list/detail/checklist and message-sending boarding-pass path. |
| `artifacts/api-server/src/routes/emptyLegPassengers.ts` | `228–245,248–331,334–388,391–478`: manifest reads/writes, winner/lock checks, protected lead passenger. |
| `artifacts/api-server/src/lib/epdMode.ts` | `25–63`: EPD mode and default. |
| `artifacts/api-server/src/lib/epdClient.ts` | `1–40`: EPD Commerce and Gateway clients and configured API hosts. |
| `artifacts/api-server/src/lib/icsSync.ts` | `97–118`: JetInsight trip/feed references. |
| `artifacts/api-server/src/lib/quoConnector.ts` | `47,156–170,284`: Quo API URL, message flow and outbound request. |
| `artifacts/api-server/src/lib/sendblueConnector.ts` | `23–27,413–430,526`: Sendblue API URLs and outbound request. |
| `artifacts/api-server/src/routes/webhooksSendgrid.ts` | `1–9,124–134`: SendGrid webhook contract and handler. |
| `artifacts/api-server/src/lib/gotoConnect.ts` | `31–36`: GoTo API endpoints. |
| `artifacts/api-server/src/routes/webhooksGoto.ts` | `40–50`: GoTo Connect event webhook. |
| `artifacts/api-server/src/lib/hubspotClient.ts` | `23–41`: HubSpot API host and configuration gate. |
| `artifacts/api-server/src/lib/metaCapi.ts` | `107–120,163`: Meta CAPI event submission. |
| `artifacts/api-server/src/routes/charter.ts` | `375–404`: charter-specific booking request, not empty-leg booking. |
| `lib/api-spec/openapi.yaml` | `7–9,42–115,117–165,1065–1127,2759–2815,3063–3197,3330–3528,3740–3868,3903–3927`: base path and declared API contracts. |
| `lib/api-zod/src/generated/api.ts` | `116–120,331–345`: generated profile response DOB coercion and the beginning of the generated update-request schema. |
| `lib/api-client-react/src/generated/api.ts` | `481–499`: generated `/api/me` client path. |
| `lib/db/src/schema/index.ts` | `1–60`: exported schema set; no `bookings` or `trips` table export. |
| `node_modules/.pnpm/@clerk+express@2.1.9_express@5.2.1/node_modules/@clerk/express/dist/index.mjs` | `201–220`: installed middleware sets `acceptsToken: "any"`; **development dependency source only**. |
| `node_modules/.pnpm/@clerk+backend@3.4.1/node_modules/@clerk/backend/dist/chunk-ZNXT7ZQM.mjs` | `541–552,582–594`: installed backend parses Bearer Authorization; **development dependency source only**. |

Replit deployment metadata is a separate evidence source, not a repository file: it reports deployed/public/autoscale/successful-build plus the hostnames listed in section 2, with no revision identifier.

## 10. Recommended integration architecture

```text
Bluebird Website ── Clerk session ──┐
                                    ├── existing Bluebird API (/api)
Bluebird Mobile ── same-instance ───┘           │
                 Clerk Bearer token              └── existing PostgreSQL data
```

Use one Bluebird API and one Clerk instance per environment:

- Development mobile should authenticate against a development API configured for the matching Clerk Development instance and its corresponding development database.
- Production mobile should use the production API base URL and a native Clerk client configured for the same Clerk instance/key environment that the API process uses. Do not put the Clerk secret key in the app.
- Send the Clerk session token in `Authorization: Bearer <token>` on protected API calls. Use the native client’s token refresh/session lifecycle; do not persist a browser cookie or copy a website cookie to mobile.
- Reuse the existing routes and preserve server-side profile, active-membership, queue-winner, manifest-lock, and trip-owner gates. A separate mobile backend is not indicated.
- Treat `/api/me` as a status summary only, not a reliable profile-existence/failure discriminator. Until the API contract is improved, use the profile GET/PUT flow and handle an ambiguous current-user failure conservatively.
- Do not use `GET /api/trips/:legId` or `GET /api/empty-legs/:id/passengers` as “read-only probes”; both may create rows. Do not use phone verification, queue, boarding-pass, or activation endpoints as production health checks.

This architecture is recommended from source inspection. Live URL, domain routing, exact deployed Clerk instance, and runtime token acceptance remain blockers to calling it verified.

## 11. Minimum safe implementation steps

1. **Verify target identity before coding against production.** Obtain deployment/revision metadata that binds `bluebirdjets.com`, the API service, and a source commit/build identifier. The current metadata is insufficient for that binding.
2. **Choose matching environment pairs.** Confirm which Clerk instance is represented by the production key names and confirm the API’s effective `DATABASE_URL` target without revealing values. Keep Development and Production app/API/database combinations separate.
3. **Configure native Clerk auth only after step 2.** Use the Expo-compatible Clerk SDK and the same instance as the corresponding API. Keep server-only keys on the server. Make a fresh Clerk session token available to the API client and set the mobile API base URL.
4. **Validate in a non-production environment with a test account.** Check anonymous `/api/me`, authenticated `/api/me`, missing/incomplete/complete profiles, `GET/PUT /api/me/profile`, `/api/plans`, `/api/membership`, flight search, queue eligibility errors, owned trips, and manifest authorization. Avoid side-effecting calls unless they are part of a controlled test plan.
5. **Resolve signup verification configuration.** Establish whether `QUO_PIN_VERIFICATION_ENABLED` is intentionally disabled or supplied outside the visible variable inventory. Test the PIN flow only in a controlled non-production environment; confirm provider delivery, status/check behavior, profile persistence, and Clerk phone sync.
6. **Address client-contract ambiguity before broad rollout.** Agree on an explicit contract for distinguishing signed-out, authenticated-without-profile, and backend failure; do not derive this from `isMember`. Reconcile generated/OpenAPI response types with actual profile date and activation behavior.
7. **Only then run a controlled production smoke check.** It should use an explicitly authorized test identity and non-destructive endpoints. Keep phone start, queue joining, payment activation, passenger writes, and message-sending out of a generic smoke test.

These are recommendations only; no implementation, environment change, or live validation was performed.

## 12. Verification blockers

The following evidence is still needed before this audit can claim the live production architecture is fully verified:

- **Domain and routing:** read-only DNS/custom-domain mapping and a safe public request to establish where `bluebirdjets.com` actually routes. Not performed.
- **Deployed revision parity:** deployment ID/build source commit or equivalent immutable revision fingerprint. Not present in metadata returned.
- **Production runtime:** API health/log evidence and effective runtime config. No application endpoint was called and no process/log inspection was used as production evidence.
- **Clerk instance:** non-secret evidence identifying whether the configured production Clerk key pair maps to the intended production instance, plus current enabled provider/verification policies. Key values were not accessed.
- **Bearer interoperability:** a controlled native token request to a matching non-production API, then separately authorized production validation if needed. Neither was performed.
- **Environment resolution:** shared-scope presence views do not establish which variable value is effective in the deployed process. `NODE_ENV` is set by checked-in production artifact configuration but not present in the variable inventory.
- **Phone PIN operation:** `QUO_PIN_VERIFICATION_ENABLED` is absent from the inspected production/development/shared inventory; no runtime test establishes whether it is injected elsewhere. If absent in the process, the code returns 503 at start. Provider credentials’ presence does not prove the feature flag or delivery works.
- **Database target and account state:** `DATABASE_URL` is present, but no database URL values or records were inspected. The actual production database and any historical phone/email account reconciliation are unknown.
- **API contract/runtime parity:** OpenAPI/generated contracts have the discrepancies listed above; production output has not been compared.
- **Native app status:** no mobile artifact or native client exists in this repository’s declared artifact set; no native Clerk implementation was built or tested here.

### Coverage checklist against the six attachment parts

- [x] **Part 1 — Identify the real production deployment:** documented application/service configuration, entry point, router, source directories, intended combined web/API deployment, third-party integrations, alternative-backend search, deployment metadata, and unknown domain/revision parity.
- [x] **Part 2 — Clerk authentication:** covered provider/SDKs, signup/sign-in/session/token flow, separate application phone verification, API middleware, Bearer support, pending sessions, impersonation, legacy/special token paths, cookies/CORS, validation options, environment selection, and configuration inventory.
- [x] **Part 3 — Bluebird user data:** mapped schemas and identity keys; traced first/returning sign-in, profile creation/update, active membership association, verified family linking, uniqueness, and duplicate risks without reading personal records.
- [x] **Part 4 — Real API contract:** inventoried current-user/profile/signup/phone, plans/membership, flight search/queue, trips/checklist, and passenger operations with methods, mounted paths, auth gates, formats, errors, source references, middleware, and contract drift. Included the dedicated `/api/me` state table.
- [x] **Part 5 — Mobile compatibility:** answered all ten questions, including Bearer support, cookies, existing routes, same/different Clerk instances, separate backend necessity, registration reuse, and minimum safe work.
- [x] **Part 6 — Production configuration:** listed environment variable names and presence only; separated artifact-configured production behavior from shared/development inventory and explicitly marked runtime values/unknowns without printing credentials or URLs.

**Change boundary:** This audit created only `BLUEBIRD_REAL_PRODUCTION_ARCHITECTURE_AUDIT.md`. Application, artifact configuration, environment, database, Clerk, and connected-service data were not changed.
