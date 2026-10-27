# Bluebird iOS release configuration

This note records Bluebird's owner-confirmed Expo/EAS identity and the remaining requirements for an iOS production build and App Store submission. No app identity, EAS project, credentials, or production environment values were created here.

## Replit Publish Expo authentication diagnosis (2026-10-26)

This was a read-only investigation of the reported `EXPO_UNAUTHORIZED` error.
No app identity, credentials, build, or submission was changed or created.

- **Saved and resolved identity: unchanged.** `app.json` and
  `expo config --type public --json` both resolve owner `bogryashov01`, slug
  `bluebird`, EAS project ID
  `83e7e28f-bdf2-4b83-9e9d-0727ba066b2c`, and iOS bundle ID
  `com.bluebirdjets.app`. These match the owner-confirmed active association
  recorded below.
- **Connected Expo personal integration: query succeeds.** The connected
  `Expo (personal)` MCP integration is marked ready. Its read-only iOS build
  list for this project returned an empty list without an authorization error.
  This shows that this integration can query the project; it does not verify
  Replit Publish's session or mean a build was created.
- **Publish authentication: not observable from this workspace.** The personal
  Expo integration and Replit's managed Publishing/Launch path are separate
  observable contexts. Bluebird's local Preview script invokes
  `create-launch login` with the Replit-provided Expo session when present;
  that Preview helper and its workflow log do not expose the identity or
  validity of the Publish session. No authentication token or secret value was
  read. A successful personal-integration query cannot establish that Publish
  is authenticated as the project owner.
- **No verified user-facing Expo re-login or reconnect path.** Replit's
  published mobile Launch guidance describes a managed cloud flow and documents
  Apple account setup, but does not document an Expo-specific login, account
  selection, logout, or reconnect control for a failed Publish session. Do not
  reconnect the personal Expo integration as a supposed fix for the separate
  Publish session; no evidence shows those sessions are shared.
- **Rejection stage: undetermined.** The available task report names
  `EXPO_UNAUTHORIZED`, but contains no raw Publishing log, request/trace ID,
  route, full message, or attempt timestamp. The refreshed workspace logs
  contain app workflow and deployment output, not the Publishing tool's
  request-level diagnostics. Therefore this evidence cannot locate the error
  before project authorization, during EAS build creation, or at another
  backend step. No such stage is inferred here.
- **Safe next step.** In the Project Editor, open **Publishing** and choose
  **View logs** beside the failed deployment. If the logs do not identify the
  rejection, use the **? / Get Help** control at the top-right of Replit to
  contact Replit Support. Include the Repl/workspace URL, app name, the
  existing Expo owner/slug/project ID/bundle ID above, the exact error text,
  and the failure timestamp with timezone. Ask Support to trace the
  Replit-managed Expo/Launch principal and session validity, verify its access
  to the existing EAS project, identify the request route and exact failing
  stage, and confirm whether a user-facing session reset is supported or
  backend repair is required. Do not include credentials or tokens.

## Active EAS project association (2026-10-26)

- Per the owner's instruction, Bluebird now targets Expo owner `bogryashov01`,
  project `bluebird`, EAS project ID
  `83e7e28f-bdf2-4b83-9e9d-0727ba066b2c`.
- The configured app slug remains `bluebird`; iOS bundle identifier remains
  `com.bluebirdjets.app`. Only the local Expo owner/project association was
  changed.
- A read-only iOS build listing for this project succeeded and returned no
  builds. This confirms the connected Expo account can read the project; it
  does not verify signing credentials, App Store Connect association, or
  whether App Store Connect already uses build number `1`.
- No build or submission was started. A new cloud build may be required, but
  signing readiness, production EAS environment values, Apple submission
  access, and the numeric App Store Connect app ID remain unverified.

## EAS identity verification (2026-10-20)

- **Effective Expo owner:** `replit-private-cd8d8a20-320c-4224-accf-5c9dc7df2ff1`.
- **Effective EAS project ID:** `7becc11e-ad08-40c7-ab29-317fe74c6ed7`.
- **Effective slug / iOS bundle identifier:** `bluebird` / `com.bluebirdjets.app`.
- These exact owner-confirmed values are persisted in `app.json` and were
  verified in Expo's locally resolved public config. This is local config
  evidence; no Expo account session, EAS CLI, or local `.eas` linkage metadata
  was available for a remote account check.
- The EAS `production` build profile remains configured with
  `environment: "production"` and `distribution: "store"`. The `@clerk/expo`
  plugin remains configured with `appleSignIn: false`; production
  authentication gates and runtime code were not changed.
- **Apple signing reuse: unverified.** This workspace had no authorized,
  read-only EAS credential inspection available. Certificate validity,
  provisioning-profile status, and association with
  `com.bluebirdjets.app` therefore cannot be established. No signing
  credentials or provisioning profiles were created or changed.
- **Another iOS EAS store build attempt is not ready.** Before retrying, the
  owner must inspect the existing iOS credentials in the authorized Expo/EAS
  account and confirm that a valid, reusable profile/certificate is associated
  with `com.bluebirdjets.app`. The production EAS environment values and the
  separate production-auth approval gate also remain outside this workspace's
  verification.
- **Exact changed files:** `artifacts/bluebird/app.json`,
  `artifacts/bluebird/RELEASE-CONFIGURATION.md`, and
  `artifacts/bluebird/IOS-BUILD-READINESS.md`.
- No EAS build or App Store submission was started.

## Current production configuration audit (2026-10-20)

- The checked-in EAS `production` profile explicitly selects the named
  `production` environment and store distribution. It does not extend either
  Development profile. This verifies the profile selection only, not the
  values stored in Expo/EAS.
- This workspace has no production values for the three Main API variables
  below. The connected Replit environment does not expose the owner's remote
  EAS production environment, so its values, visibility, and access controls
  remain unverified. No production request was made.
- Mobile Main API selection is explicit: only the selected environment's
  matching API URL and Clerk key are consumed. The production API URL is
  restricted to the existing canonical HTTPS `/api` endpoint; Development,
  Preview, legacy API, and wrong Clerk-key-type values fail configuration
  validation rather than becoming Main API fallbacks.
- Production Clerk sign-in is not active by default. The Mobile provider now
  has a separate Production gate, but it stays blocked until the API and Clerk
  owners approve the matching pair and the owner-configured production
  environment explicitly enables it. A `pk_live_` value alone is not approval.
  Do not turn on the Development flag or reuse its key.
- The legacy generated API client can also receive `EXPO_PUBLIC_DOMAIN`.
  Because the remote EAS values could not be inspected, the owner must verify
  that the Production EAS environment does not point this legacy base URL at a
  Development or Replit Preview service. This is an external configuration
  verification blocker, not evidence that such a value is currently set.


### Production Clerk pair verification status (2026-10-21)

- **Local Production configuration shape: PASS.** The recorded Production
  Preview check confirms the canonical Production API endpoint, a live Clerk
  publishable key, and a configured issuer host matching the host encoded in
  that key. No values are reproduced here. This is a local consistency check;
  it does not establish that the issuer is API-owner-verified or that the
  deployed API accepts tokens from that Clerk instance.
- **Mobile token construction: CONFIRMED IN SOURCE.** The prepared client calls
  Clerk `getToken()` without a template argument and sends the result as a
  Bearer token.
- **Owner checks: REPORTED COMPLETE.** On 2026-10-21, the project owner
  confirmed that the API owner verified the Production issuer and token
  acceptance contract; API and Clerk owners approved the exact pair, identity
  mapping, and allowed client configuration; and an authorized owner checked
  the remote Production environment. No environment values or credentials are
  included here. This records the owner's confirmation; it is not an
  independent remote inspection from this workspace.
- **Production sign-in: NOT ENABLED BY THAT AUDIT.** No approval flag or remote
  setting was changed there. The later read-only verification below records
  that the current workspace Preview already inherits an enabled local flag;
  this is not evidence of the value in EAS's remote `production` environment.
  The flag remains a separate rollout gate and does not close the remaining
  native/rollout readiness checks.

## Native Production auth verification (2026-10-21)

This is a read-only audit. No Clerk Dashboard or EAS setting, key, URL, approval
flag, API, or authentication gate was changed. No authenticated Production API
request, EAS build, or submission was made.

### Production web Preview origin

- **Observed browser result: BLOCKED.** The Bluebird Preview at
  `https://cd8d8a20-320c-4224-accf-5c9dc7df2ff1-00-1ud53d7apx2xl-6jjx16uq.expo.worf.replit.dev`
  received HTTP 400 while Clerk initialized. The browser reported:
  `Clerk: Production Keys are only allowed for domain "bluebirdjets.com". API Error: The Request HTTP Origin header must be equal to or a subdomain of the requesting URL.`
- This is a Production Clerk domain/origin rejection, not an Expo startup or
  mobile configuration error. The current Replit Preview host is outside the
  accepted `bluebirdjets.com` domain, so this web Preview is not supported by
  the observed Production Clerk configuration.
- Read-only Clerk management status was `not_configured` with dashboard access
  unavailable. Therefore the current Clerk Dashboard could not be inspected
  to confirm whether it offers a separate allowed-origin setting. Do not assume
  that adding a Replit origin is supported. The domain-compatible way to test
  the web UI is to serve it from `https://bluebirdjets.com` or a subdomain that
  the Clerk owner confirms is accepted by this Production instance.
- The exact Preview hostname above is session/workspace-specific; it is
  recorded only to identify the origin used for this observation.

### Native path and Production EAS environment

- **Source/configuration: PARTIAL READY.** The existing Expo project is
  `bluebird` (`com.bluebirdjets.app`) with the existing EAS project ID and a
  checked-in `production` profile using `environment: "production"` and
  `distribution: "store"`. `@clerk/expo` is integrated behind the Production
  configuration gate. Its native token cache uses Expo SecureStore, and the
  app contains phone-code sign-in/sign-up routes. This is native SDK code, not
  a browser sign-in embedded at the Replit Preview origin.
- Native app requests use the Clerk SDK/session and the Main API's bearer-token
  transport; the application does not add a browser `Origin` header to those
  requests. Native networking is not subject to browser CORS origin checks.
  The app also has the `bluebird` URL scheme. SecureStore persistence, session
  restoration, return routing, and Clerk Production acceptance have not been
  exercised on a physical iOS device.
- The Clerk provider, phone-code UI, session bridge, and authenticated `/api/me`
  member-resolution path are wired in source when the matching Production
  configuration enables them. This does not verify Clerk token acceptance by
  the deployed Main API. `PRODUCTION_AUTH_AVAILABILITY` remains `unavailable`
  for member data pending the recorded token-acceptance and member-identity
  checks.
- The named remote EAS `production` environment could not be inspected from
  this workspace. EAS CLI is not available here, and no authorized read-only
  EAS environment listing was available. **Remote presence is UNVERIFIED** for
  each of these variables: `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT`,
  `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL`,
  `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER`,
  `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH`, and `EXPO_PUBLIC_DOMAIN`.
- The separate local-workspace preflight reported the first five variables
  present, Production selected, URL/key/issuer formats valid, key/issuer host
  parity matched, and the local approval flag present. In that preflight
  process, `EXPO_PUBLIC_DOMAIN` was not configured; the Preview launcher sets
  its own Preview domain at runtime. These are workspace-only statuses; they do
  not establish remote EAS presence or values.
- **Native Production authentication: BLOCKED / NOT DEVICE-VERIFIED.** The
  owner must use authorized Expo access to verify the six remote variable
  presences above without exposing values, confirm any `EXPO_PUBLIC_DOMAIN`
  target is not a Development or Preview API, and confirm the existing iOS
  Production build is available for testing. API/Clerk owner approval of the
  exact pair and token contract is recorded as owner-reported in the earlier
  audit, not independently rechecked here.

### Next safe native test

After the authorized EAS environment check and owner confirmation that the
approved API/Clerk pair and rollout gate are correct, use an already available
Production TestFlight build of `com.bluebirdjets.app` on an owner-controlled
iPhone. Sign in with an approved test account; verify a fresh session, close
and reopen the app to check SecureStore restoration, then sign out and confirm
the session is cleared. Only after the API owner authorizes a controlled
authenticated request should the tester verify token acceptance at the
Production `/api/me` endpoint. If no compatible Production binary is already
available, request a separate owner-approved build/device test; this audit did
not start one.

## Local Production web Preview

The existing Bluebird artifact Preview continues to use the `dev` script and
Development workflow. For an isolated local web Preview that evaluates
runtime-based Production configuration, run:

```sh
pnpm --filter @workspace/bluebird run preview:production-web
```

This Mobile-only command uses Expo's `--no-dev --minify` web mode, selects the
Production Main API environment and Production flight reads, and inherits
`EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL` rather than replacing the
canonical URL. It also inherits `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH` when
the caller supplies it; the launcher does not set or fabricate this flag.
Production Clerk remains blocked unless the existing runtime checks pass,
including Production API selection, the matching live publishable key and
API-owner-verified issuer, and the separately documented owner approvals. The
flag's presence alone is not evidence of owner approval. The command uses the
assigned `PORT` and localhost host mode; it does not change the artifact Preview
wiring. No EAS build or deployment is required.

## Production EAS environment

Configure the named EAS `production` environment with these public app-configuration variables:

- `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT` must select `production`.
- `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_BASE_URL` must identify the Production Main Bluebird API. The mobile configuration accepts only its configured canonical HTTPS `/api` endpoint.
- `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_CLERK_PUBLISHABLE_KEY` must be the Production Clerk publishable key (`pk_live_…`) for the Clerk instance paired with that API.
- `EXPO_PUBLIC_BLUEBIRD_PRODUCTION_API_CLERK_ISSUER` must be the API-owner-verified Production Clerk issuer and match the instance encoded in the Production publishable key.
- `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH=true` is the explicit rollout approval gate. Set it only after both API and Clerk owners confirm the Production pairing, token acceptance, and identity mapping; otherwise leave it unset.

The API URL, environment selector, and Clerk publishable key are embedded in the mobile app configuration; they are not server secrets. The publishable key is public by design but must belong to the correct Production Clerk instance. Do not put private keys, API tokens, or other server credentials in `EXPO_PUBLIC_` variables or in this repository. Keep any genuine secrets in an approved secret store.

## Owner inputs required

- Confirm that the existing Apple signing credentials are valid and associated with `com.bluebirdjets.app` through an authorized, read-only EAS credential inspection. Do not create or change credentials as part of this verification.
- Supply the App Store Connect app's numeric Apple ID (`ascAppId`) if submission should be non-interactive. No App Store Connect app ID is available in this project.
- Provide authorized Apple Developer / App Store Connect access and configure signing/submission credentials through EAS when the owner is ready. Do not commit Apple credentials or add guessed team/account values here.

The `submit.production` profile intentionally leaves `ios` values empty until those owner inputs are available; EAS Submit can prompt for missing values interactively.

## Owner-authorized native Production auth test (2026-10-26)

- A dedicated `production-auth-test` iOS build profile now extends the existing
  store-distribution Production profile and explicitly selects the EAS
  `production` environment. It forces the Main API selector to Production,
  disables Development Clerk auth, full-app demo, local flight fixtures, and
  membership mocks, and enables a build-time native-auth-test request guard.
- The profile does **not** set `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH` or
  provide an API URL, Clerk key, or issuer. The existing Production Clerk gate
  remains fail-closed and must already be enabled in the authorized EAS
  Production environment after the existing owner approvals. Missing or
  mismatched Production settings still block Clerk provider mounting.
- In this build, the application API boundary allows only authenticated
  `GET https://bluebirdjets.com/api/me`. The production-auth transport blocks
  all other endpoints and methods, including potentially side-effecting GET
  endpoints. The generated/legacy API client is separately pinned away from
  `EXPO_PUBLIC_DOMAIN` and restricted to the same path. Queue, profile,
  membership, referral, payment, passenger, phone-verification, and other
  operations cannot reach the API through these clients.
- The deployed Production Main API handler is not present in this workspace.
  Although the earlier owner report approved the client configuration, the API
  owner must reconfirm that `/api/me` remains genuinely read-only before any
  live authenticated request.
- Source confirms `@clerk/expo` receives Clerk's token cache (SecureStore-backed
  on native), the session bridge exposes the current `getToken`, the adapter
  obtains a fresh token per request, and the approved request attaches it as a
  Bearer token. This is source/test evidence only; no token or secret key is
  embedded in this report.
- The sanitized local preflight reports the Production selector, API/Clerk
  formats, issuer-host parity, and local approval gate as ready. This validates
  only the current Replit workspace's effective configuration, not the remote
  EAS `production` environment or API-owner approval. An earlier owner-reported
  EAS check is recorded above; it was not independently repeated in this task.
- The local app version and bundle ID remain `1.0.0` and
  `com.bluebirdjets.app`. The checked-in iOS build number remains `1` because
  the latest uploaded TestFlight/App Store Connect build could not be verified
  with authorized EAS/Apple access. Do not start a build until the owner checks
  the latest uploaded number and advances the local build number only from that
  evidence. Signing credentials and App Store Connect submission identity also
  remain owner-controlled checks.
- No Production or Clerk Dashboard setting was changed. No live sign-in,
  authenticated request, API mutation, EAS build, upload, TestFlight
  submission, deployment, or Git operation was performed. Automated checks do
  not establish physical-device sign-in or SecureStore restoration.

After the owner has verified the remote Production inputs, approval gate,
latest uploaded build number, and signing readiness, use the authorized Expo
publishing workflow only if it supports selecting `production-auth-test`.
Do not substitute the general `production` profile for this restricted test.
The existing submit profile has no configured `ascAppId`, so owner-authorized
App Store Connect access may be needed for a later submission. Internal
TestFlight tester-group availability was not inspected or changed. No build or
submission was started for this audit.

## Before an owner-authorized TestFlight build

1. In the organization-owned Expo account, inspect the `production` EAS
   environment and verify the API URL, environment selector, and live Clerk
   key belong to the approved Production API/Clerk pair. Also inspect
   `EXPO_PUBLIC_DOMAIN`; remove it if unused or verify its approved Production
   destination. Do not paste values into chat or commit them.
2. Confirm the Production Clerk/API pairing with their authorized owners.
   The checked-in canonical URL and a `pk_live_` prefix are validation rules,
   not proof that the remote Clerk instance or API owner approved that pairing.
3. In the authorized Expo/EAS account, inspect existing iOS signing
   credentials and confirm their validity and association with
   `com.bluebirdjets.app`. Use the owner's approved EAS/Apple workflow for any
   later credential changes; this audit made none.
4. Keep `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH` unset until both API and
   Clerk owners approve the Production pairing, token acceptance, and identity
   mapping. After approval, configure the API-owner-verified issuer and enable
   the separate Production provider. Missing or mismatched settings remain a
   sign-in blocker; no legacy-host fallback or Development configuration is
   an acceptable substitute.
5. Confirm the app version/build number and Universal Link association with
   the owner, then run a future owner-authorized iOS build/device-validation
   task. This audit started no build, upload, or submission.

## Production auth-test readiness for Build 7 (2026-10-27)

### Verified configuration and runtime evidence

- The checked-in `production-auth-test` profile is store-distributed and
  explicitly selects EAS `production`. It sets the Production API selector,
  native auth-test guard, Production flight/membership modes, and disables
  Development Clerk and full-app demo. It does not override the separate
  Production Clerk approval flag or the API/key/issuer values.
- The status-only local preflight passed: Production selected; API URL, live
  key, issuer and local approval gate present; API URL/key/issuer formats
  valid; key/issuer host syntax matched; local login status ready. No
  publishable key, issuer, token, or secret value was printed. This is Replit
  workspace evidence only; this workspace cannot inspect the remote EAS
  `production` environment or establish API/Clerk owner approval.
- The connected Expo account's read-only build list confirms an iOS
  `production-auth-test` Build 6 (`1.0.0`, build version `6`) finished on
  2026-10-27. The checked-in `app.json` still has build number `1`; this audit
  did not change it. Build-log retrieval returned an error and the TestFlight
  crash-data query returned an error, so neither provided startup diagnostics.
- No authenticated Production request, live sign-in, write, build, upload, or
  submission was performed. No Apple, Expo, Clerk, API, or remote environment
  setting was changed.
- **Build 7 diagnostic update (2026-10-27):** a subsequent read-only EAS build
  query confirms a finished iOS `production-auth-test` artifact
  (`1.0.0`, build version `7`). The record does not prove that this binary was
  installed during the reported iPhone attempt. The available Expo connection
  cannot list remote EAS environment-variable presence, and no Build 7 Apple
  Console event sequence was available; see `STARTUP-AUTH-DIAGNOSIS.md`.

### Clerk startup and request path

1. The profile supplies `EXPO_PUBLIC_BLUEBIRD_API_ENVIRONMENT=production` and
   sets `EXPO_PUBLIC_ENABLE_CLERK_AUTH=false`. Production auth does not use
   that Development flag: it still expects Clerk, and remains blocked unless
   the separate `EXPO_PUBLIC_ENABLE_PRODUCTION_CLERK_AUTH` gate is enabled in
   the selected environment.
2. Before mounting `ClerkProvider`, Mobile requires the Production selector,
   explicit approval gate, canonical Production API URL, a valid `pk_live_`
   key, and HTTPS issuer-host parity with the key. Host parity is syntax
   validation, not proof of owner approval. Invalid configuration never
   falls back to the Development key or legacy session.
3. The provider uses Clerk Expo's native token cache. Its bridge propagates
   `isLoaded`, sign-in state, current user ID and `getToken`. Production
   startup fails closed after 15 seconds if Clerk never loads; Retry remounts
   the provider. Phone sign-in routes to the existing signed-in route only
   after Clerk reports a loaded signed-in session.
4. A signed-in, loaded session triggers identity-bound authenticated
   `GET /api/me` resolution. The API adapter calls `getToken()` for each
   request and attaches the fresh token as a Bearer header. The test-build
   request guard runs before token lookup/fetch and allows only the exact
   Production `GET /api/me` URL.

### Build 6 owner-authorized iPhone reproduction (2026-10-27)

- The owner tested Build 6 on a real iPhone using Apple Console. The native
  splash appeared briefly, then a full-screen loading spinner remained
  indefinitely; the phone sign-in screen never appeared and the app did not
  visibly crash.
- Console showed generic Bluebird-process messages associated with Security,
  trust evaluation, and preferences, but no explicit Clerk initialization
  error, React Native exception, or API failure. These messages do not prove a
  Keychain or TLS failure and are not treated as the cause.
- The Build 6 source explains the indefinite spinner: the root route returned
  its loading view until the Clerk snapshot reported `isLoaded`. In Clerk mode,
  the legacy session-restoration effect exits without clearing its loading
  state. If the Clerk snapshot stays absent or unloaded, the root route never
  reaches its sign-in redirect. The Build 6 code had no bounded Clerk startup
  timeout or Bluebird startup-event logging.
- The bounded 15-second Production startup timeout, Retry path, and safe
  provider/readiness diagnostics were added after Build 6. They replace the
  unbounded wait in the current source, but have not been verified on an
  iPhone in a later binary. No EAS build was created for this investigation.

**Finding:** the Mobile-owned cause of the *indefinite loading screen* is the
unbounded wait for Clerk readiness in Build 6. The evidence does not establish
why Clerk failed to become loaded on that device. Build 6 predates the
diagnostic events, so provider mount, Clerk readiness, phone-code completion,
and signed-in navigation cannot be reconstructed from its Console capture.
No TestFlight crash or feedback submission was available, EAS Observe returned
no iOS versions/events for the app, and the detailed EAS build-log request
timed out. Do not infer an underlying Clerk, Keychain, TLS, configuration, or
API fault from the current evidence.

The current source's safe diagnostics can distinguish `production_mode`,
`provider_mount`, `initialization_start`, `readiness_change` (including
`isLoaded`), `timeout`, and `initialization_error`; they also mark a loaded
signed-in session, successful phone sign-in/sign-up, signed-in route requests,
route reach, and synchronous route failures. Diagnostic fields are limited to
fixed event names, booleans, attempt counters, and broad error categories.
They never include SDK messages, keys, tokens, phone numbers, session data, or
member identifiers. None of these app-specific events were present in Build 6.

### Production API scope for this test profile

Only `/api/me` is enabled by the native request policy. The routes below are
blocked in this build unless separately reviewed and explicitly approved.
The evidence boundary and endpoint contract summary in
`MAIN-API-INTEGRATION-REVIEW.md` still apply.

| Screen or flow | Request | Build 7 status and reason |
| --- | --- | --- |
| Clerk post-sign-in profile-routing check | Authenticated `GET /api/me` | Allowed by the Mobile guard. The API owner must reconfirm this endpoint is still read-only before any live call. Its response can route only on profile-completion booleans; it does not verify Bluebird member identity or member capabilities. |
| Bluebird Profile / Personal Information | `GET /api/me/profile` | Blocked. The supplied contract says this GET may synchronize verified-phone data; it is not safe to assume it is read-only. |
| Profile, notification, airport, and onboarding saves | `PUT /api/me/profile` and other writes | Blocked. Every app API write is denied by the native guard. The profile PUT response contract also remains disputed between the supplied snapshot and current Mobile parser. |
| Membership overview | Authenticated `GET /api/membership` | Blocked. The shape is documented, but current deployed read-only behavior has not been verified. No membership fixture is substituted in Production mode. |
| Membership plan catalog | Public `GET /api/plans` | Blocked by this narrow test allowlist. It is described as public/read-only in the supplied audit, but the current deployed endpoint and response contract are not independently verified. |
| Discover, map and flight details | Public `GET /api/empty-legs`, `GET /api/empty-legs/{id}`, and airport lookup GETs | Blocked by this allowlist. Mobile selects Production flight mode and does not use local fixtures in a release build; failed/blocked real requests remain errors rather than demo flights. Current deployed support and response compatibility still need confirmation. |
| Queue and trip screens | Authenticated `GET /api/empty-legs/{id}/queue`, `GET /api/trips` | Blocked. Contract/source audit evidence is not live Production verification; queue personalization and member identity remain unconfirmed. |
| Passenger and phone verification | Passenger-list GET and phone-verification-status GET | Blocked. The supplied Mobile/API review identifies possible server-side mutations from these GETs, so they are not safe probes. |

All other GETs, every POST/PUT/PATCH/DELETE, and wrong-host/path/query variants
are denied before the app API fetch. The guard is exercised for both the
Production JSON transport and generated API client. The release profile
disables demo mode; mock membership mode is development-only, and local flight
reads require a development runtime. Production API errors are not replaced
with mock/demo responses.

### Checks and owner prerequisites before Build 7

- PASS — status-only local Production preflight. Remote EAS environment
  presence/value statuses remain unverified from this workspace.
- PASS — `test:native-production-auth` (5 tests), `test:clerk-startup` (9
  tests), Clerk auth configuration tests (11 tests), `test:production-auth-api`
  (23 tests), and `test:production-flight-api`.
- PASS — Bluebird `typecheck` after rebuilding the shared
  `lib/api-client-react` TypeScript output. The first check used stale
  composite output and reported 192 downstream errors; the rebuilt check
  passed.
- Source-only checks do not establish live Clerk sign-in, secure-session
  restoration, Production token acceptance, response compatibility, or
  physical iPhone behavior.

Before creating Build 7, the owner should:

1. In the authorized Expo account, verify the remote EAS `production`
   environment by presence/status only: Production selector, canonical API
   URL, Production Clerk key and matching API-owner-verified issuer, approval
   gate, and `EXPO_PUBLIC_DOMAIN` absent or confirmed to be the approved
   Production destination. Do not paste or store values in this report.
2. Obtain current API- and Clerk-owner confirmation of the exact Production
   pair, token acceptance, Clerk-to-account mapping, and the test account's
   permission to sign in. Keep the approval gate off if any item is unknown.
3. Have the API owner reconfirm that `GET /api/me` is read-only. Keep all
   profile, membership, flight, queue, trip, passenger, and phone-status
   requests blocked until their exact endpoint and response contract are
   reviewed and their read-only behavior is explicitly approved.
4. Confirm in App Store Connect that Build 6 is the latest uploaded build.
   The EAS build list shows version `6`, but this audit did not inspect
   App Store Connect/TestFlight upload state. Only if confirmed, update the
   checked-in iOS build number from `1` to `7`; inspect existing signing
   readiness through authorized read-only access.
5. Once all gates and build-number evidence are confirmed, use the authorized
   Expo build flow with the `production-auth-test` profile. Install Build 7 on
   an owner-controlled iPhone, record the safe startup diagnostics, verify
   cold start, existing-account phone sign-in, app restart/session restoration,
   and sign-out, then request only the API-owner-approved `GET /api/me`.
   Do not test sign-up, profile changes, purchases, queue actions, or any
   other Production write in this test.
